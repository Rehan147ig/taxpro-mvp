/**
 * API Integration Test Suite — End-to-End Provision Lifecycle
 * 
 * Tests the complete API flow:
 *   1. Auth & Login -> JWT Token
 *   2. POST /api/provision/run -> Provision calculation & run creation
 *   3. GET /api/provision/runs/:id/ai-findings -> Subagent findings & tracing state
 *   4. GET /api/provision/runs/:id/review-items -> Review queue item listing
 *   5. POST /api/provision/runs/:id/review-items/:itemId/resolve -> Item approval & active learning trigger
 *   6. POST /api/provision/runs/:id/review-items/bulk-resolve -> Bulk resolution
 *   7. POST /api/provision/runs/:id/finalize -> Provision run finalization
 *   8. GET /api/provision/results/:id/package -> ZIP workpaper & audit log export
 *   9. POST /api/provision/runs/:id/submit-for-approval -> Partner review submission
 *  10. POST /api/provision/runs/:id/partner-approve -> Partner sign-off (separate user)
 *  11. POST /api/provision/runs/:id/lock -> Final lock (immutable)
 *  12. POST /api/mapping/mappings/:accountId/override -> Post-lock mutation rejected (409)
 *  13. GET /api/provision/runs/:id/events -> Audit trail contains submit/approve/lock
 *  14. Cross-tenant isolation -> Foreign tenant cannot read demo run data
 */

import { Hono } from 'hono';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { provisionRoutes } from '../src/modules/provision/provision.routes.js';
import { importRoutes } from '../src/modules/import/import.routes.js';
import { mappingRoutes } from '../src/modules/mapping/mapping.routes.js';

import { errorHandler } from '../src/lib/middleware/error-handler.js';
import { db } from '../src/config/db.js';
import { tenants } from '../src/db/schema/tenants.js';
import { provisionResults } from '../src/db/schema/provision-results.js';
import { provisionRuns } from '../src/db/schema/provision-runs.js';
import { eq } from 'drizzle-orm';

// Setup in-process Hono test application
const app = new Hono();
app.onError(errorHandler);
app.route('/api/auth', authRoutes);
app.route('/api/provision', provisionRoutes);
app.route('/api/import', importRoutes);
app.route('/api/mapping', mappingRoutes);

interface TestStepResult {
  step: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const testResults: TestStepResult[] = [];
let skippedSteps = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runStep(name: string, fn: () => Promise<string | void>) {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    testResults.push({ step: name, passed: true, durationMs, details: details ?? 'Passed' });
    console.log(`  ✅ ${name} (${durationMs}ms)${details ? `\n     ${details}` : ''}`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    testResults.push({ step: name, passed: false, durationMs, details: err.message });
    console.error(`  ❌ ${name} failed: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('\n🧪 Starting TaxPro End-to-End API Integration Test Suite\n');

  // Step 0: Reset demo tenant state so the suite is repeatable.
  //   provision_events are append-only (immutable audit) and are NEVER touched.
  //   Terminal runs (approved/locked) are reset to failed/not_required — TEST-ONLY for the
  //   demo tenant — because POST /run skips review-item creation when an identical
  //   approved run exists (dedup guard). Events documenting the prior lifecycle remain.
  await runStep('0. Reset demo tenant state', async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'acme-demo')).limit(1);
    assert(!!tenant, 'Demo tenant (acme-demo) not found — run db:seed first');
    await db.delete(provisionResults).where(eq(provisionResults.tenantId, tenant.id));
    const reset = await db.update(provisionRuns)
      .set({ status: 'failed', approvalStatus: 'not_required', updatedAt: new Date() })
      .where(eq(provisionRuns.tenantId, tenant.id));
    return `Cleared results + reset ${reset.rowCount ?? 0} run(s) to failed/not_required (events kept — immutable audit)`;
  });

  let authToken = '';
  let provisionRunId = '';
  let resultId = '';
  let reviewItems: any[] = [];

  // Step 1: Login & Authenticate
  await runStep('1. Authentication (POST /api/auth/login)', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'demo@taxpro.ai',
        password: 'TaxProDemo123!',
      }),
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(!!data.token, 'Response missing token');
    assert(!!data.tenant?.id, 'Response missing tenant.id');
    authToken = data.token;
    return `Logged in successfully (Tenant ID: ${data.tenant.id})`;
  });

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  // Step 2: Trigger Provision Run (Direct / Eve)
  await runStep('2. Provision Run (POST /api/provision/run)', async () => {
    const res = await app.request('/api/provision/run?direct=true', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        period: '2026-01-01',
      }),
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(!!data.id, 'Response missing result id');
    assert(!!data.provisionRunId, 'Response missing provisionRunId');
    assert(typeof data.summary?.totalTaxExpense === 'number', 'Missing tax calculation summary');

    resultId = data.id;
    provisionRunId = data.provisionRunId;
    return `Run ID: ${provisionRunId} | Result ID: ${resultId} | Mode: ${data.mode} | Tax Expense: $${data.summary.totalTaxExpense.toLocaleString()}`;
  });

  // Step 3: Fetch Subagent Findings
  await runStep('3. AI Findings (GET /api/provision/runs/:id/ai-findings)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/ai-findings`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.provisionRunId === provisionRunId, 'Run ID mismatch in findings');
    assert(Array.isArray(data.agents), 'agents field must be an array');
    const statusSummary = data.agents.map((a: any) => `${a.workflowName}:${a.status}`).join(', ');
    return `Found ${data.agents.length} agent trace record(s) (Pending: ${data.pending})${statusSummary ? ` [${statusSummary}]` : ''}`;
  });

  // Step 4: Fetch Review Items Queue
  await runStep('4. Fetch Review Items (GET /api/provision/runs/:id/review-items)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/review-items`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    reviewItems = await res.json();
    assert(Array.isArray(reviewItems), 'Review items response must be an array');

    const depreciationItem = (reviewItems as any[]).find((i) => i.itemType === 'missing_depreciation_metadata');
    assert(!!depreciationItem, 'Expected a missing_depreciation_metadata review item for the seeded depreciation account (no placed-in-service date)');
    assert(depreciationItem.accountId !== undefined, 'Depreciation metadata item must reference the account');
    return `Retrieved ${reviewItems.length} review item(s) for run (incl. depreciation metadata flag: ${depreciationItem.title})`;
  });

  // Step 5: Resolve Review Item (Single Resolution & Pattern Feedback)
  if (reviewItems.length > 0) {
    await runStep('5. Single Item Resolution (POST /runs/:id/review-items/:itemId/resolve)', async () => {
      const targetItem = reviewItems[0];
      const res = await app.request(`/api/provision/runs/${provisionRunId}/review-items/${targetItem.id}/resolve`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          resolution: 'approved',
          resolutionNote: 'Integration test approved mapping',
        }),
      });

      assert(res.status === 200, `Expected status 200, got ${res.status}`);
      const data = await res.json();
      assert(data.status === 'resolved', `Expected status resolved, got ${data.status}`);
      return `Resolved item ${targetItem.id} (Remaining open: ${data.openRemaining})`;
    });
  } else {
    skippedSteps++;
    console.log('  ⏭️  5. Single Item Resolution — SKIPPED (no open review items; subagent findings unavailable)');
  }

  // Step 6: Bulk Resolve Remaining Items
  await runStep('6. Bulk Resolve Items (POST /runs/:id/review-items/bulk-resolve)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/review-items/bulk-resolve`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        resolution: 'approved',
        resolutionNote: 'Bulk approved by integration test',
      }),
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'resolved', `Expected status resolved, got ${data.status}`);
    return `Bulk resolved ${data.resolved} item(s)`;
  });

  // Step 7: Finalize Provision Run
  await runStep('7. Finalize Run (POST /runs/:id/finalize)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/finalize`, {
      method: 'POST',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'finalized', `Expected status finalized, got ${data.status}`);
    return `Provision run ${provisionRunId} finalized successfully`;
  });

  // Step 8: Package Export (.zip with .xlsx + audit logs)
  await runStep('8. Package Export (GET /results/:id/package)', async () => {
    const res = await app.request(`/api/provision/results/${resultId}/package`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const contentType = res.headers.get('Content-Type');
    assert(contentType?.includes('application/zip') ?? false, `Expected Content-Type application/zip, got ${contentType}`);

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert(bytes.length > 100, `Zip buffer too small (${bytes.length} bytes)`);
    // Zip signature PK\x03\x04
    assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'Invalid ZIP magic header signature');
    return `Exported ${bytes.length.toLocaleString()} byte ZIP package containing workpapers + audit logs`;
  });

  // Step 9: Submit for Partner Approval
  await runStep('9. Submit for Approval (POST /runs/:id/submit-for-approval)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/submit-for-approval`, {
      method: 'POST',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.approvalStatus === 'pending_partner_review', `Expected pending_partner_review, got ${data.approvalStatus}`);
    return `Run ${provisionRunId} submitted for partner review`;
  });

  // Step 10: Partner Sign-off (separate user to prove reviewer/approver separation)
  let partnerToken = '';
  await runStep('10. Partner Sign-off (POST /runs/:id/partner-approve)', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'partner@taxpro.ai',
        password: 'TaxProDemo123!',
      }),
    });
    assert(loginRes.status === 200, `Partner login failed: ${loginRes.status}`);
    const loginData = await loginRes.json();
    partnerToken = loginData.token;

    const res = await app.request(`/api/provision/runs/${provisionRunId}/partner-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${partnerToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.approvalStatus === 'approved', `Expected approved, got ${data.approvalStatus}`);
    return `Run approved by partner@taxpro.ai`;
  });

  // Step 11: Lock Final Provision
  await runStep('11. Lock Final Provision (POST /runs/:id/lock)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${partnerToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'locked', `Expected status locked, got ${data.status}`);
    return `Provision run ${provisionRunId} locked (immutable)`;
  });

  // Step 12: Mutation after lock is rejected with 409
  await runStep('12. Post-Lock Mutation Rejected (409)', async () => {
    const mappingsRes = await app.request('/api/mapping/mappings', {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
    const mappings = await mappingsRes.json();
    assert(Array.isArray(mappings) && mappings.length > 0, 'No mappings available to attempt override');
    const accountId = mappings[0].accountId ?? mappings[0].id;

    const res = await app.request(`/api/mapping/mappings/${accountId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        taxAccountType: 'PERM_OTHER',
        bookTreatment: 'permanent',
        provisionRunId,
      }),
    });

    assert(res.status === 409, `Expected 409 conflict, got ${res.status}: ${await res.text()}`);
    return 'Mapping override after lock correctly rejected with 409';
  });

  // Step 13: Audit trail captures the governance lifecycle
  await runStep('13. Audit Trail (GET /runs/:id/events)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/events`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const events = await res.json();
    assert(Array.isArray(events), 'events must be an array');
    const types = (events as any[]).map((e) => e.eventType);
    for (const expected of ['submitted_for_approval', 'partner.approved', 'run.locked']) {
      assert(types.includes(expected), `Missing audit event: ${expected}`);
    }
    return `Audit trail contains ${events.length} event(s): ${types.join(', ')}`;
  });

  // Step 14: Cross-tenant isolation
  await runStep('14. Tenant Isolation (cross-tenant access blocked)', async () => {
    const suffix = Date.now().toString(36);
    const regRes = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `iso-${suffix}@test.local`,
        password: 'Password123!',
        tenantName: 'Isolation Test',
        tenantSlug: `iso-${suffix}`,
      }),
    });
    assert(regRes.status === 201, `Foreign tenant registration failed: ${regRes.status}`);
    const reg = await regRes.json();
    const foreignHeaders = { 'Authorization': `Bearer ${reg.token}` };

    const itemsRes = await app.request(`/api/provision/runs/${provisionRunId}/review-items`, { headers: foreignHeaders });
    assert(itemsRes.status === 200, `Expected 200, got ${itemsRes.status}`);
    const items = await itemsRes.json();
    assert(Array.isArray(items) && items.length === 0, 'Foreign tenant must not see demo review items');

    const pkgRes = await app.request(`/api/provision/results/${resultId}/package`, { headers: foreignHeaders });
    assert(pkgRes.status !== 200, 'Foreign tenant must not access demo export package');

    return `Foreign tenant blocked from demo run data (items: ${items.length}, package export: HTTP ${pkgRes.status})`;
  });

  const totalSteps = testResults.length + skippedSteps;
  const skipNote = skippedSteps > 0 ? ` (${skippedSteps} skipped)` : '';
  console.log('\n================================================================================');
  console.log(`🎉 ALL INTEGRATION TEST STEPS PASSED (${testResults.length}/${totalSteps})${skipNote}`);
  console.log('================================================================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test Suite Aborted with Errors:', err);
    process.exit(1);
  });
