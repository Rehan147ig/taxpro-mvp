/**
 * Unit-level test for the auto-mapping precedent engine.
 * Tests DB operations directly without needing the HTTP server running.
 */
import 'dotenv/config';
import { db, withTenantContext, closeDb } from '../src/config/db.js';
import { accounts } from '../src/db/schema/accounts.js';
import { taxMappings } from '../src/db/schema/tax-mappings.js';
import { reviewItems } from '../src/db/schema/review-items.js';
import { classificationPatterns } from '../src/db/schema/classification-patterns.js';
import { provisionEvents } from '../src/db/schema/provision-events.js';
import { aiRuns } from '../src/db/schema/ai-runs.js';
import { and, eq, desc, sql } from 'drizzle-orm';
import { findPrecedentMappings, suggestMapping, findPatternMatches } from '../src/modules/import/auto-mapping/precedent-engine.js';
import { recordProvisionEvent, EVENT_TYPES } from '../src/modules/provision/provision-events.js';
import { startAiRun, completeAiRun } from '../src/eve/trace-store.js';

const TENANT_ID = '5db3b211-8d3a-4858-bc2c-932ba1175cde';

async function main() {
  console.log('\n🧪 Phase 4: Auto-Draft Mapping — Unit Test');
  console.log('='.repeat(70));

  // Clean up any previous test data from this run
  console.log('\n--- Cleanup previous test data ---');
  const oldMappings = await db.delete(taxMappings)
    .where(and(
      eq(taxMappings.tenantId, TENANT_ID),
      eq(taxMappings.status, 'draft'),
    )).returning({ id: taxMappings.id });
  console.log(`  Deleted ${oldMappings.length} old draft mappings`);

  const oldItems = await db.delete(reviewItems)
    .where(and(
      eq(reviewItems.tenantId, TENANT_ID),
      eq(reviewItems.status, 'open'),
    )).returning({ id: reviewItems.id });
  console.log(`  Deleted ${oldItems.length} old review items`);

  // Find or create test accounts
  console.log('\n--- Test Accounts ---');
  let allAccounts = await db.select().from(accounts).where(eq(accounts.tenantId, TENANT_ID));

  const testAccountDefs = [
    { externalId: 'phase4-cash',   name: 'Cash',                   type: 'Asset' },
    { externalId: 'phase4-ar',     name: 'Accounts Receivable',    type: 'Asset' },
    { externalId: 'phase4-ap',     name: 'Accounts Payable',       type: 'Liability' },
    { externalId: 'phase4-rev',    name: 'Revenue - Services',     type: 'Income' },
    { externalId: 'phase4-sal',    name: 'Salaries and Wages',     type: 'Expense' },
    { externalId: 'phase4-rd',     name: 'Research and Development Costs', type: 'Expense' },
    { externalId: 'phase4-meals',  name: 'Meals and Entertainment',type: 'Expense' },
    { externalId: 'phase4-depr',   name: 'Fixed Asset Depreciation',type: 'Expense' },
    { externalId: 'phase4-bad',    name: 'Bad Debt Reserve',       type: 'Expense' },
    { externalId: 'phase4-other',  name: 'Other Operating Expense',type: 'Expense' },
  ];

  for (const def of testAccountDefs) {
    const existing = allAccounts.find(a => a.externalId === def.externalId);
    if (!existing) {
      await db.insert(accounts).values({
        tenantId: TENANT_ID,
        externalId: def.externalId,
        accountNumber: def.externalId.replace('phase4-', ''),
        name: def.name,
        type: def.type,
        isSummary: false,
      });
    }
  }

  allAccounts = await db.select().from(accounts).where(eq(accounts.tenantId, TENANT_ID));
  const acctMap = new Map(allAccounts.map(a => [a.externalId, a]));
  console.log(`  ${allAccounts.length} total accounts for tenant`);

  // Create approved precedent mappings (simulate CPA-approved)
  console.log('\n--- Approved Precedent Mappings ---');
  const precedentDefs = [
    { ext: 'phase4-cash',  type: 'NODIFF_CASH',      treat: 'no_diff' as const, confidence: '0.95' },
    { ext: 'phase4-ar',    type: 'NODIFF_AR',        treat: 'no_diff' as const, confidence: '0.95' },
    { ext: 'phase4-ap',    type: 'NODIFF_AP',        treat: 'no_diff' as const, confidence: '0.95' },
    { ext: 'phase4-rev',   type: 'NODIFF_REVENUE',   treat: 'no_diff' as const, confidence: '0.90' },
    { ext: 'phase4-sal',   type: 'NODIFF_SALARIES',  treat: 'no_diff' as const, confidence: '0.90' },
  ];

  for (const p of precedentDefs) {
    const acct = acctMap.get(p.ext);
    if (!acct) continue;
    // Check if mapping exists
    const existing = await db.select().from(taxMappings)
      .where(and(
        eq(taxMappings.tenantId, TENANT_ID),
        eq(taxMappings.accountId, acct.id),
        eq(taxMappings.status, 'active'),
      )).limit(1);
    if (existing.length === 0) {
      await db.insert(taxMappings).values({
        tenantId: TENANT_ID,
        accountId: acct.id,
        taxAccountType: p.type,
        bookTreatment: p.treat,
        confidenceScore: p.confidence,
        suggestedByAi: false,
        status: 'active',
        version: 1,
      });
      console.log(`  Created: ${acct.name} → ${p.type} (active)`);
    } else {
      console.log(`  Exists:  ${acct.name} → ${p.type} (active)`);
    }
  }

  // Run precedent engine — only accounts WITHOUT existing mappings (like the worker does)
  console.log('\n=== Running Precedent Engine ===');
  const allMappings = await db.select().from(taxMappings).where(eq(taxMappings.tenantId, TENANT_ID));
  const mappedAccountIds = new Set(allMappings.map(m => m.accountId));
  const phase4Accounts = allAccounts.filter(a =>
    a.externalId && a.externalId.startsWith('phase4-') && !mappedAccountIds.has(a.id)
  );
  console.log(`  Processing ${phase4Accounts.length} accounts (${allAccounts.filter(a => a.externalId && a.externalId.startsWith('phase4-')).length - phase4Accounts.length} already have mappings)`);

  const accountTypes = [...new Set(phase4Accounts.map(a => a.type))];
  const precedentsByType = new Map<string, Awaited<ReturnType<typeof findPrecedentMappings>>>();
  for (const t of accountTypes) {
    precedentsByType.set(t, await findPrecedentMappings(db, TENANT_ID, t));
    const precedents = precedentsByType.get(t)!;
    console.log(`  ${t}: ${precedents.length} precedent(s)`);
  }

  let draftCount = 0;
  let reviewCount = 0;
  let exactCount = 0;
  let patternCount = 0;
  let fallbackCount = 0;

  for (const account of phase4Accounts) {
    const precedents = precedentsByType.get(account.type) ?? [];
    const suggestion = await suggestMapping(db, TENANT_ID, account, precedents);

    if (suggestion.matchedBy === 'exact') exactCount++;
    else if (suggestion.matchedBy === 'pattern') patternCount++;
    else fallbackCount++;

    await db.insert(taxMappings).values({
      tenantId: TENANT_ID,
      accountId: account.id,
      taxAccountType: suggestion.taxAccountType,
      bookTreatment: suggestion.bookTreatment,
      timingCategory: suggestion.timingCategory,
      confidenceScore: String(suggestion.confidenceScore),
      suggestedByAi: true,
      aiExplanation: suggestion.rationale,
      status: 'draft',
      version: 1,
    });
    draftCount++;

    if (suggestion.confidenceLabel === 'low' || suggestion.matchedBy === 'fallback') {
      await db.insert(reviewItems).values({
        tenantId: TENANT_ID,
        itemType: 'low_confidence_mapping',
        severity: 'medium',
        status: 'open',
        title: `Review auto-mapping for ${account.name}`,
        description: suggestion.rationale,
        accountId: account.id,
        sourceRef: account.accountNumber,
        confidenceScore: Math.round(suggestion.confidenceScore * 100),
        metadata: JSON.stringify({
          taxAccountType: suggestion.taxAccountType,
          bookTreatment: suggestion.bookTreatment,
          timingCategory: suggestion.timingCategory,
          matchedBy: suggestion.matchedBy,
        }),
      });
      reviewCount++;
    }

    console.log(`  ${account.name.padEnd(35)} → ${suggestion.taxAccountType.padEnd(30)} score=${suggestion.confidenceScore.toFixed(2)} ${suggestion.confidenceLabel.padEnd(6)} ${suggestion.matchedBy.padEnd(7)}`);
  }

  // Results
  console.log('\n=== Results ===');
  console.log(`  Draft mappings created: ${draftCount}`);
  console.log(`  Review items created:  ${reviewCount}`);
  console.log(`  Exact matches: ${exactCount}, Pattern: ${patternCount}, Fallback: ${fallbackCount}`);

  // Verify in DB
  const dbDrafts = await db.select().from(taxMappings)
    .where(and(
      eq(taxMappings.tenantId, TENANT_ID),
      eq(taxMappings.status, 'draft'),
    ));
  console.log(`\n  Verified in DB: ${dbDrafts.length} draft mappings`);

  const dbItems = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.tenantId, TENANT_ID),
      eq(reviewItems.status, 'open'),
    ));
  console.log(`  Verified in DB: ${dbItems.length} open review items`);

  // Quality checks
  const allHaveRationale = dbDrafts.every(m => m.aiExplanation && m.aiExplanation.length > 0);
  const allHaveConfidence = dbDrafts.every(m => Number(m.confidenceScore ?? 0) > 0);

  console.log(`  All drafts have rationale: ${allHaveRationale}`);
  console.log(`  All drafts have confidence scores: ${allHaveConfidence}`);

  const checkPassed = draftCount > 0 && reviewCount > 0 && allHaveRationale && allHaveConfidence;
  console.log(`\n${'='.repeat(70)}`);
  console.log(checkPassed ? '🎉 ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED');
  console.log(`${'='.repeat(70)}\n`);

  await closeDb();
  process.exit(checkPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
