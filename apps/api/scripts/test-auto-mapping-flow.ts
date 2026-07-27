/**
 * Phase 4 Integration Test: Auto-Draft Mapping on Trial Balance Import
 *
 * End-to-end test:
 * 1. Authenticate as a CPA user
 * 2. Import a trial balance CSV
 * 3. Verify auto-mapping job was enqueued
 * 4. Wait for auto-mapping worker to complete
 * 5. Verify draft mappings were created
 * 6. Verify summary endpoint
 * 7. Verify review items for low-confidence mappings
 * 8. Verify mapping.suggested and ai.workflow events
 */

import 'dotenv/config';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db, withTenantContext, closeDb } from '../src/config/db.js';
import { accounts } from '../src/db/schema/accounts.js';
import { taxMappings } from '../src/db/schema/tax-mappings.js';
import { reviewItems } from '../src/db/schema/review-items.js';
import { aiRuns } from '../src/db/schema/ai-runs.js';
import { provisionEvents } from '../src/db/schema/provision-events.js';
import { autoMappingQueue } from '../src/modules/import/auto-mapping/auto-mapping.queue.js';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api';

let apiToken: string;
let tenantId: string;

// Helpers
async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...options?.headers,
    },
  });
  return res;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.log(`\n  ❌ ${message}`);
    throw new Error(`Assertion Failed: ${message}`);
  }
  console.log(`  ✅ ${message}`);
}

async function runStep(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ ${name} failed: ${msg}`);
    console.log(`\n❌ Test Suite Aborted with Errors: ${msg}`);
    process.exit(1);
  }
}

// ── CSV data for import ──
const csvData = [
  'entity,entityName,accountNumber,accountName,accountType,period,periodEnd,debit,credit,balance,currency',
  // High-confidence accounts (should match precedents or get draft mappings)
  'TestCorp,TestCorp,1000,Cash,Asset,2026-01-01,2026-12-31,50000,0,50000,USD',
  'TestCorp,TestCorp,2000,Accounts Receivable,Asset,2026-01-01,2026-12-31,25000,0,25000,USD',
  'TestCorp,TestCorp,3000,Inventory,Asset,2026-01-01,2026-12-31,75000,0,75000,USD',
  'TestCorp,TestCorp,4000,Accounts Payable,Liability,2026-01-01,2026-12-31,0,15000,-15000,USD',
  'TestCorp,TestCorp,5000,Revenue - Services,Income,2026-01-01,2026-12-31,0,200000,-200000,USD',
  'TestCorp,TestCorp,6000,Salaries and Wages,Expense,2026-01-01,2026-12-31,120000,0,120000,USD',
  // Low-confidence / new accounts (should create review items)
  'TestCorp,TestCorp,7000,Research and Development Costs,Expense,2026-01-01,2026-12-31,30000,0,30000,USD',
  'TestCorp,TestCorp,8000,Meals and Entertainment,Expense,2026-01-01,2026-12-31,5000,0,5000,USD',
  'TestCorp,TestCorp,9000,Fixed Asset Depreciation,Expense,2026-01-01,2026-12-31,15000,0,15000,USD',
  'TestCorp,TestCorp,9500,Bad Debt Reserve,Expense,2026-01-01,2026-12-31,2000,0,2000,USD',
].join('\n');

async function main() {
  console.log('\n🧪 Phase 4: Auto-Draft Mapping on Trial Balance Import');
  console.log('='.repeat(70));

  // ── 1. Authentication ──
  console.log('\n--- Authentication ---');
  const loginRes = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'cpa@example.com', password: 'demo-password' }),
  });
  assert(loginRes.ok, 'Login succeeded');
  const loginData = await loginRes.json();
  apiToken = loginData.token;
  tenantId = loginData.user.tenantId;
  assert(!!apiToken, 'Received API token');
  assert(!!tenantId, 'Tenant ID available');
  console.log(`     Logged in successfully (Tenant ID: ${tenantId})`);

  // ── 2. Import Trial Balance ──
  console.log('\n--- Import Trial Balance ---');
  const importRes = await api('/import/trial-balance', {
    method: 'POST',
    body: JSON.stringify({ csv: csvData, source: 'test-auto-mapping' }),
  });
  assert(importRes.status === 201, `Import returned 201, got ${importRes.status}`);
  const importData = await importRes.json();
  assert(importData.importedRows === 10, `Imported 10 rows, got ${importData.importedRows}`);
  assert(!!importData.autoMappingJobId, 'Auto-mapping job ID returned');
  console.log(`     Imported ${importData.importedRows} rows, job ID: ${importData.autoMappingJobId}`);

  // ── 3. Wait for auto-mapping worker ──
  console.log('\n--- Auto-Mapping Worker ---');
  let jobResult: any = null;
  for (let i = 0; i < 30; i++) {
    const statusRes = await api(`/import/auto-mapping/status/${importData.autoMappingJobId}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      if (statusData.state === 'completed') {
        jobResult = statusData.result;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert(jobResult !== null, 'Auto-mapping worker completed within 30s');
  assert(jobResult.total === 10, `Processed 10 accounts, got ${jobResult.total}`);
  assert(jobResult.drafted > 0, `Created ${jobResult.drafted} draft mappings`);
  console.log(`     ${jobResult.summary}`);
  console.log(`     Breakdown: exact=${jobResult.matchedByBreakdown.exact}, pattern=${jobResult.matchedByBreakdown.pattern}, fallback=${jobResult.matchedByBreakdown.fallback}`);

  // ── 4. Verify draft mappings in DB ──
  console.log('\n--- Draft Mappings Verification ---');
  const draftMappings = await withTenantContext(tenantId, async (tx) => {
    const mappings = await tx.select().from(taxMappings)
      .where(and(
        eq(taxMappings.tenantId, tenantId),
        eq(taxMappings.status, 'draft'),
      ));
    return mappings as (typeof taxMappings.$inferSelect)[];
  });
  assert(draftMappings.length > 0, `Found ${draftMappings.length} draft mappings in DB`);

  // Check that each draft mapping has a rationale
  const allHaveRationale = draftMappings.every((m) => m.aiExplanation && m.aiExplanation.length > 0);
  assert(allHaveRationale, 'All draft mappings have rationale (aiExplanation)');

  // Check confidence scores
  const allHaveConfidence = draftMappings.every((m) => Number(m.confidenceScore ?? 0) > 0);
  assert(allHaveConfidence, 'All draft mappings have confidence scores');

  console.log(`     Total draft mappings: ${draftMappings.length}`);
  for (const m of draftMappings.slice(0, 3)) {
    console.log(`       - ${m.taxAccountType} | score: ${m.confidenceScore} | ${m.aiExplanation?.slice(0, 80)}...`);
  }
  if (draftMappings.length > 3) {
    console.log(`       ... and ${draftMappings.length - 3} more`);
  }

  // ── 5. Verify review items for low-confidence mappings ──
  console.log('\n--- Review Items Verification ---');
  const reviewItemCount = await withTenantContext(tenantId, async (tx) => {
    const items = await tx.select().from(reviewItems)
      .where(and(
        eq(reviewItems.tenantId, tenantId),
        eq(reviewItems.itemType, 'low_confidence_mapping'),
        eq(reviewItems.status, 'open'),
      ));
    return items.length;
  });
  assert(reviewItemCount > 0, `Found ${reviewItemCount} review item(s) for low-confidence mappings`);

  // ── 6. Verify summary endpoint ──
  console.log('\n--- Summary Endpoint ---');
  const summaryRes = await api('/import/auto-mapping/summary');
  assert(summaryRes.ok, 'Summary endpoint returns 200');
  const summaryData = await summaryRes.json();
  assert(summaryData.draftMappings > 0, `Summary reports ${summaryData.draftMappings} draft mappings`);
  assert(summaryData.openReviewItems >= 0, `Summary reports ${summaryData.openReviewItems} open review items`);
  assert(typeof summaryData.message === 'string' && summaryData.message.includes('Draft mapping ready'),
    `Summary message: "${summaryData.message}"`);
  console.log(`     ${summaryData.message}`);
  console.log(`     Accounts: ${summaryData.totalAccounts} | Drafts: ${summaryData.draftMappings} | Active: ${summaryData.activeMappings} | Review items: ${summaryData.openReviewItems}`);

  // ── 7. Verify events were emitted ──
  console.log('\n--- Event Verification ---');
  const events = await withTenantContext(tenantId, async (tx) => {
    const evts = await tx.select().from(provisionEvents)
      .where(and(
        eq(provisionEvents.tenantId, tenantId),
        eq(provisionEvents.actorType, 'agent'),
      ))
      .orderBy(desc(provisionEvents.occurredAt))
      .limit(20);
    return evts;
  });

  const workflowStarted = events.find((e) => e.eventType === 'ai.workflow.started');
  const mappingSuggested = events.find((e) => e.eventType === 'mapping.suggested');
  const actionEscalated = events.find((e) => e.eventType === 'ai.action.escalated');

  assert(!!workflowStarted, 'ai.workflow.started event found');
  assert(!!mappingSuggested, 'mapping.suggested event found');
  assert(!!actionEscalated, 'ai.action.escalated event found (for low-confidence items)');

  // Check ai.workflow.completed in aiRuns table
  const aiRunRecords = await withTenantContext(tenantId, async (tx) => {
    const runs = await tx.select().from(aiRuns)
      .where(and(
        eq(aiRuns.tenantId, tenantId),
        eq(aiRuns.workflowName, 'auto_mapping'),
      ))
      .orderBy(desc(aiRuns.createdAt))
      .limit(1);
    return runs;
  });
  assert(aiRunRecords.length > 0, 'aiRuns record created');
  assert(aiRunRecords[0].status === 'completed', `aiRun status = ${aiRunRecords[0].status}`);

  console.log(`     Events found: ai.workflow.started ✅, mapping.suggested ✅, ai.action.escalated ✅, ai.workflow.completed ✅`);

  // ── Summary ──
  console.log('\n' + '='.repeat(70));
  console.log(`🎉 ALL AUTO-MAPPING INTEGRATION TEST STEPS PASSED`);
  console.log('='.repeat(70) + '\n');

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Test Suite Aborted with Errors:', err.message);
  process.exit(1);
});
