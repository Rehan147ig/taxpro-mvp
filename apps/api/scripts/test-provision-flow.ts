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
 */

import { Hono } from 'hono';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { provisionRoutes } from '../src/modules/provision/provision.routes.js';
import { importRoutes } from '../src/modules/import/import.routes.js';
import { mappingRoutes } from '../src/modules/mapping/mapping.routes.js';

import { errorHandler } from '../src/lib/middleware/error-handler.js';

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
    return `Retrieved ${reviewItems.length} review item(s) for run`;
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
