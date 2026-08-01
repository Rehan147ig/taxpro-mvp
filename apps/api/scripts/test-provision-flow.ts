/**
 * API Integration Test Suite — End-to-End Provision Lifecycle
 *
 * Tests the complete API flow:
 *   0. Hard safety guard (must pass before any mutation)
 *   1. Auth & Login -> JWT Token
 *   2. POST /api/import/trial-balance -> Import additional trial balance data
 *   3. GET /api/import/trial-balance/export -> Verify imported data
 *   4. POST /api/import/trial-balance -> Validation rejection (malformed CSV)
 *   5. GET /api/mapping/mappings -> Retrieve mappings
 *   6. POST /api/mapping/mappings/:accountId/override -> Override before lock
 *   7. POST /api/provision/run -> Provision calculation & run creation
 *   8. Wait for AI subagent traces to reach terminal states
 *   9. GET /api/provision/runs/:id/review-items -> Review queue
 *  10. Verify missing_depreciation_metadata review item
 *  11. POST /api/provision/runs/:id/review-items/:itemId/resolve -> Single resolve
 *  12. POST /api/provision/runs/:id/review-items/bulk-resolve -> Bulk resolve
 *  13. POST /api/provision/runs/:id/finalize -> Finalize
 *  14. GET /api/provision/results/:id/package -> Pre-lock package export (basic)
 *  15. POST /api/provision/runs/:id/submit-for-approval -> Submit
 *  16. POST /api/provision/runs/:id/partner-approve -> Partner sign-off
 *  17. POST /api/provision/runs/:id/lock -> Lock
 *  18. Verify locked status
 *  19. POST /api/mapping/mappings/:accountId/override -> Post-lock 409
 *  20. GET /api/provision/results/:id/package -> Post-lock package (comprehensive)
 *  21. GET /api/provision/runs/:id/events -> Audit trail verification
 *  22. Verify mapping.override + export.package audit events
 *  23. Create foreign tenant
 *  24. Cross-tenant isolation (review items, results, package, mappings, import)
 *  25. Verify no pending agents
 *
 * Invocation (PowerShell):
 *   $env:NODE_ENV='test'
 *   $env:TAXPRO_TEST_MODE='1'
 *   npm run test:integration -w @taxpro/api
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
import { createHash } from 'crypto';
import { inflateRawSync } from 'zlib';

// ── Setup in-process Hono test application ──
const app = new Hono();
app.onError(errorHandler);
app.route('/api/auth', authRoutes);
app.route('/api/provision', provisionRoutes);
app.route('/api/import', importRoutes);
app.route('/api/mapping', mappingRoutes);

// ── Test result tracking ──
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

// ── Step 0: Hard test-environment safety guard ──
function assertSafeTestEnvironment() {
  const nodeEnv = process.env.NODE_ENV;
  const testMode = process.env.TAXPRO_TEST_MODE;

  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    console.error(`\n❌ SAFETY GUARD: NODE_ENV is '${nodeEnv}'. Must be 'development' or 'test'.`);
    console.error('   Set $env:NODE_ENV=\'test\' before running integration tests.');
    process.exit(1);
  }

  if (testMode !== '1') {
    console.error('\n❌ SAFETY GUARD: TAXPRO_TEST_MODE is not set to "1".');
    console.error('   Set $env:TAXPRO_TEST_MODE=\'1\' before running integration tests.');
    process.exit(1);
  }

  const dbUrl = (process.env.DATABASE_URL ?? '').toLowerCase();
  const productionHosts = [
    'rds.amazonaws.com',
    '.neon.tech',      // catches ep-*.us-east-2.aws.neon.tech etc
    'aws.neon.tech',
    'supabase.co',
    'railway.app',
    'render.com',
    'fly.dev',
  ];

  for (const host of productionHosts) {
    if (dbUrl.includes(host)) {
      console.error(`\n❌ SAFETY GUARD: DATABASE_URL appears to be a production host (matched '${host}').`);
      console.error('   Integration tests must run against a local/development database.');
      process.exit(1);
    }
  }

  const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('host.docker.internal');
  const remoteAllowed = process.env.TAXPRO_ALLOW_REMOTE_DB === '1';

  if (!isLocalhost && !remoteAllowed) {
    console.error('\n❌ SAFETY GUARD: DATABASE_URL is not a local database.');
    console.error(`   URL: ${dbUrl.substring(0, 40)}...`);
    console.error('   Set TAXPRO_ALLOW_REMOTE_DB=1 if you intentionally want to test against a remote DB.');
    process.exit(1);
  }

  console.log('  ✅ Safety guard passed (NODE_ENV=' + nodeEnv + ', TAXPRO_TEST_MODE=' + testMode + ')');
}

// ── AI trace polling helper ──
const TRACKED_SUBAGENTS = ['subagent_mapping_agent', 'subagent_audit_defense', 'subagent_credit_miner'] as const;
const TERMINAL_STATES = new Set(['completed', 'failed', 'timeout', 'fallback_used']);

interface AgentTrace {
  workflowName: string;
  status: string;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  errorMessage: string | null;
  completedAt: string | null;
}

async function waitForAiTraces(
  provisionRunId: string,
  authHeaders: Record<string, string>,
  timeoutMs: number = 120_000,
): Promise<AgentTrace[]> {
  const start = Date.now();
  const pollInterval = 800;

  while (Date.now() - start < timeoutMs) {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/ai-findings`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `AI findings endpoint returned ${res.status}`);
    const data = await res.json();

    const agents: AgentTrace[] = data.agents ?? [];
    const tracked = agents.filter((a: AgentTrace) => TRACKED_SUBAGENTS.includes(a.workflowName as any));

    const allTerminal = tracked.length === TRACKED_SUBAGENTS.length
      && tracked.every((a: AgentTrace) => TERMINAL_STATES.has(a.status));

    if (allTerminal) {
      return tracked;
    }

    const stillStarted = tracked.filter((a: AgentTrace) => a.status === 'started');
    if (tracked.length > 0 && stillStarted.length === 0 && tracked.some((a: AgentTrace) => !TERMINAL_STATES.has(a.status))) {
      // Some agents in unknown state but not started — wait a bit more
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  // Timeout: do one final check
  const res = await app.request(`/api/provision/runs/${provisionRunId}/ai-findings`, {
    method: 'GET',
    headers: authHeaders,
  });
  const data = await res.json();
  const agents: AgentTrace[] = data.agents ?? [];
  const tracked = agents.filter((a: AgentTrace) => TRACKED_SUBAGENTS.includes(a.workflowName as any));

  if (tracked.length === 0) {
    throw new Error(
      `AI trace timeout: found 0 agent trace records after ${timeoutMs}ms. ` +
      'Agents may not have been scheduled. Check subagent runner and AI provider configuration.'
    );
  }

  const stillStarted = tracked.filter((a: AgentTrace) => a.status === 'started');
  if (stillStarted.length > 0) {
    const names = stillStarted.map((a: AgentTrace) => `${a.workflowName}:${a.status}`).join(', ');
    throw new Error(
      `AI trace timeout: ${stillStarted.length} agent(s) still in 'started' state after ${timeoutMs}ms: [${names}]`
    );
  }

  return tracked;
}

// ── ZIP parser: Central Directory records at end of file ──
interface ZipCDFileHeader {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
}

function read32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function read16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function findCentralDirEnd(bytes: Uint8Array): number {
  // Search backwards for End of Central Directory Record signature (PK\x05\x06)
  // Start from the end, searching up to 65535 + 22 bytes
  const searchStart = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

function parseCDFileHeaders(bytes: Uint8Array, eocdOffset: number): Map<string, ZipCDFileHeader> {
  const entries = new Map<string, ZipCDFileHeader>();
  const cdOffset = read32LE(bytes, eocdOffset + 16);
  const decoder = new TextDecoder();

  let offset = cdOffset;
  while (offset < eocdOffset) {
    const sig = read32LE(bytes, offset);
    if (sig !== 0x02014b50) break; // Central Directory File Header signature

    const compressionMethod = read16LE(bytes, offset + 10);
    const compressedSize = read32LE(bytes, offset + 20);
    const uncompressedSize = read32LE(bytes, offset + 24);
    const fileNameLength = read16LE(bytes, offset + 28);
    const extraFieldLength = read16LE(bytes, offset + 30);
    const commentLength = read16LE(bytes, offset + 32);
    const localHeaderOffset = read32LE(bytes, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    entries.set(name, {
      name,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      compressionMethod,
    });

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }
  return entries;
}

function extractEntryData(bytes: Uint8Array, entry: ZipCDFileHeader): Uint8Array {
  let localOffset = entry.localHeaderOffset;
  // Skip local file header signature + fixed fields
  const fileNameLength = read16LE(bytes, localOffset + 26);
  const extraFieldLength = read16LE(bytes, localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraFieldLength;

  // For deflated entries (method 8), the compressed size from CD should be accurate
  const dataLen = entry.compressedSize > 0 ? entry.compressedSize : entry.uncompressedSize;
  if (dataOffset + dataLen > bytes.length) {
    return bytes.slice(dataOffset);
  }
  return bytes.slice(dataOffset, dataOffset + dataLen);
}

function inflateDeflated(data: Uint8Array): Uint8Array {
  return new Uint8Array(inflateRawSync(Buffer.from(data)));
}

function parseZipEntries(bytes: Uint8Array): Map<string, { entry: ZipCDFileHeader; data: Uint8Array }> {
  const eocdOffset = findCentralDirEnd(bytes);
  if (eocdOffset === -1) throw new Error('Cannot find End of Central Directory record in ZIP');

  const cdEntries = parseCDFileHeaders(bytes, eocdOffset);
  const result = new Map<string, { entry: ZipCDFileHeader; data: Uint8Array }>();

  for (const entry of cdEntries.values()) {
    let rawData = extractEntryData(bytes, entry);
    if (entry.compressionMethod === 8 && entry.compressedSize > 0) {
      try {
        rawData = inflateDeflated(rawData);
      } catch {
        // Keep raw data if deflate fails (already uncompressed or stored)
      }
    }
    result.set(entry.name, { entry, data: rawData });
  }

  return result;
}

function sha256(buf: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

// ── Main test flow ──
async function main() {
  console.log('\n🧪 Starting TaxPro End-to-End API Integration Test Suite\n');

  // ── Step 0: Safety guard (must pass before any DB access) ──
  assertSafeTestEnvironment();

  // ── Step 0.5: Reset demo tenant state ──
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

  // ── Step 1: Login & Authenticate ──
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

  // ── Step 2: Import additional trial balance data ──
  const importedAccountName = 'Professional fees (integration test)';
  await runStep('2. Import Trial Balance (POST /api/import/trial-balance)', async () => {
    const csvHeader = 'entity,entityName,accountNumber,accountName,accountType,period,periodEnd,debit,credit,balance,currency';
    const csvRow = `Acme US Inc.,Acme US Inc.,5900,${importedAccountName},Expense,2026-01-01,2026-12-31,75000,0,75000,USD`;
    const csv = [csvHeader, csvRow].join('\n');

    const res = await app.request('/api/import/trial-balance', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ csv, source: 'integration-test' }),
    });

    assert(res.status === 201, `Expected status 201, got ${res.status}`);
    const data = await res.json();
    assert(data.importedRows >= 1, 'Expected at least 1 imported row');
    assert(data.accounts >= 1, 'Expected at least 1 account');
    assert(!!data.autoMappingJobId, 'Expected autoMappingJobId');
    return `Imported ${data.importedRows} row(s), ${data.accounts} account(s), autoMappingJob: ${data.autoMappingJobId}`;
  });

  // ── Step 3: Verify import export ──
  await runStep('3. Verify Import Export (GET /api/import/trial-balance/export)', async () => {
    const res = await app.request('/api/import/trial-balance/export', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const csv = await res.text();
    assert(csv.includes(importedAccountName), `Export CSV must contain imported account "${importedAccountName}"`);
    assert(csv.includes('5900'), 'Export CSV must contain imported account number 5900');
    return `Export contains imported account "${importedAccountName}"`;
  });

  // ── Step 4: Import validation — malformed data rejected ──
  await runStep('4. Import Validation Rejection (POST /api/import/trial-balance)', async () => {
    const invalidCsv = 'header1,header2\nvalue1'; // missing required fields
    const res = await app.request('/api/import/trial-balance', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ csv: invalidCsv, source: 'integration-test' }),
    });

    assert(res.status === 400, `Expected status 400, got ${res.status}`);
    const data = await res.json();
    assert(!!data.error || !!data.message, 'Error response should have error or message field');
    return `Malformed import correctly rejected: HTTP ${res.status}`;
  });

  // ── Step 5: Retrieve mappings ──
  let mappingAccountId = '';
  await runStep('5. Retrieve Mappings (GET /api/mapping/mappings)', async () => {
    const res = await app.request('/api/mapping/mappings', {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const mappings = await res.json();
    assert(Array.isArray(mappings), 'Mappings response must be an array');
    assert(mappings.length > 0, 'Expected at least one mapping');
    mappingAccountId = mappings[0].accountId ?? mappings[0].id;
    return `Retrieved ${mappings.length} mapping(s)`;
  });

  // ── Step 6: Mapping override before provision run (without runId) ──
  let versionBeforeOverride = 1;
  await runStep('6. Mapping Override (POST /api/mapping/mappings/:accountId/override)', async () => {
    // Get current version first
    const getRes = await app.request(`/api/mapping/mappings/${mappingAccountId}`, {
      method: 'GET',
      headers: authHeaders,
    });
    const currentMappings = await getRes.json();
    if (Array.isArray(currentMappings) && currentMappings.length > 0) {
      versionBeforeOverride = currentMappings[currentMappings.length - 1].version ?? 1;
    }

    const res = await app.request(`/api/mapping/mappings/${mappingAccountId}/override`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        taxAccountType: 'PERM_OVERRIDE_TEST',
        bookTreatment: 'permanent',
        overrideReason: 'Integration test override before run',
      }),
    });

    assert(res.status === 201, `Expected status 201, got ${res.status}`);
    const data = await res.json();
    assert(data.isActive === true, 'New mapping should be active');
    assert(data.taxAccountType === 'PERM_OVERRIDE_TEST', 'Override should use new taxAccountType');
    assert(data.version > versionBeforeOverride, `New mapping version ${data.version} should be > ${versionBeforeOverride}`);
    versionBeforeOverride = data.version;
    return `Mapping overridden: ${data.taxAccountType}, version ${data.version}`;
  });

  // ── Step 7: Trigger Provision Run (Direct mode) ──
  await runStep('7. Provision Run (POST /api/provision/run?direct=true)', async () => {
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

  // ── Step 8: Mapping override WITH provisionRunId (triggers audit event) ──
  await runStep('8. Mapping Override with Run Context (POST /api/mapping/mappings/:accountId/override)', async () => {
    const res = await app.request(`/api/mapping/mappings/${mappingAccountId}/override`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        taxAccountType: 'TEMP_RUN_SCOPED_OVERRIDE',
        bookTreatment: 'temporary',
        timingCategory: 'deductible_temporary',
        overrideReason: 'Integration test run-scoped override',
        provisionRunId,
      }),
    });

    assert(res.status === 201, `Expected status 201, got ${res.status}`);
    const data = await res.json();
    assert(data.isActive === true, 'New mapping should be active with run-scoped override');
    return `Run-scoped mapping override: ${data.taxAccountType}, version ${data.version}`;
  });

  // ── Step 9: Wait for AI traces to terminal state ──
  await runStep('9. Wait for AI Subagent Traces (polling with timeout)', async () => {
    const traces = await waitForAiTraces(provisionRunId, authHeaders, 120_000);
    const statusSummary = traces.map((t) => `${t.workflowName}: ${t.status}`).join(', ');
    return `AI traces completed:\n     - ${traces.map(t => `${t.workflowName}: ${t.status}`).join('\n     - ')}`;
  });

  // ── Step 10: Fetch Review Items Queue ──
  await runStep('10. Fetch Review Items (GET /api/provision/runs/:id/review-items)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/review-items`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    reviewItems = await res.json();
    assert(Array.isArray(reviewItems), 'Review items response must be an array');
    return `Retrieved ${reviewItems.length} review item(s) for run`;
  });

  // ── Step 11: Verify missing_depreciation_metadata review item ──
  await runStep('11. Verify Depreciation Metadata Review Item', async () => {
    const depreciationItem = (reviewItems as any[]).find((i) => i.itemType === 'missing_depreciation_metadata');
    assert(!!depreciationItem, 'Expected a missing_depreciation_metadata review item for the seeded depreciation account (no placed-in-service date)');
    assert(depreciationItem.accountId !== undefined, 'Depreciation metadata item must reference the account');
    assert(depreciationItem.severity === 'medium' || depreciationItem.severity === 'high', `Expected medium/high severity, got ${depreciationItem.severity}`);
    return `Depreciation metadata flag: ${depreciationItem.title} (severity: ${depreciationItem.severity})`;
  });

  // ── Step 12: Resolve Review Item (Single Resolution) ──
  if (reviewItems.length > 0) {
    await runStep('12. Single Item Resolution (POST /runs/:id/review-items/:itemId/resolve)', async () => {
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
    console.log('  ⏭️  12. Single Item Resolution — SKIPPED (no open review items)');
  }

  // ── Step 13: Bulk Resolve Remaining Items ──
  await runStep('13. Bulk Resolve Items (POST /runs/:id/review-items/bulk-resolve)', async () => {
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

  // ── Step 14: Finalize Provision Run ──
  await runStep('14. Finalize Run (POST /runs/:id/finalize)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/finalize`, {
      method: 'POST',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'finalized', `Expected status finalized, got ${data.status}`);
    return `Provision run ${provisionRunId} finalized successfully`;
  });

  // ── Step 15: Pre-lock Package Export (basic) ──
  await runStep('15. Pre-Lock Package Export (GET /results/:id/package)', async () => {
    const res = await app.request(`/api/provision/results/${resultId}/package`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const contentType = res.headers.get('Content-Type');
    assert(contentType?.includes('application/zip') ?? false, `Expected Content-Type application/zip, got ${contentType}`);

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert(bytes.length > 100, `Zip buffer too small (${bytes.length} bytes)`);
    assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'Invalid ZIP magic header signature');
    return `Pre-lock ZIP exported: ${bytes.length.toLocaleString()} bytes`;
  });

  // ── Step 16: Submit for Partner Approval ──
  await runStep('16. Submit for Approval (POST /runs/:id/submit-for-approval)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/submit-for-approval`, {
      method: 'POST',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.approvalStatus === 'pending_partner_review', `Expected pending_partner_review, got ${data.approvalStatus}`);
    return `Run ${provisionRunId} submitted for partner review`;
  });

  // ── Step 17: Partner Sign-off (separate user) ──
  let partnerToken = '';
  await runStep('17. Partner Sign-off (POST /runs/:id/partner-approve)', async () => {
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

  // ── Step 18: Lock Final Provision ──
  await runStep('18. Lock Final Provision (POST /runs/:id/lock)', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${partnerToken}` },
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'locked', `Expected status locked, got ${data.status}`);
    return `Provision run ${provisionRunId} locked (immutable)`;
  });

  // ── Step 19: Verify locked status ──
  await runStep('19. Verify Locked Status (GET /api/provision/runs)', async () => {
    const res = await app.request('/api/provision/runs', {
      headers: authHeaders,
    });
    assert(res.status === 200, 'Failed to fetch runs');
    const runs = await res.json();
    const lockedRun = runs.find((r: any) => r.id === provisionRunId);
    assert(lockedRun, 'Locked run not found in runs list');
    assert(lockedRun.status === 'locked', `Expected locked status, got ${lockedRun.status}`);
    return `Run status confirmed: ${lockedRun.status}, approval: ${lockedRun.approvalStatus}`;
  });

  // ── Step 20: Mutation after lock is rejected with 409 ──
  await runStep('20. Post-Lock Mutation Rejected (409)', async () => {
    const res = await app.request(`/api/mapping/mappings/${mappingAccountId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({
        taxAccountType: 'PERM_OTHER',
        bookTreatment: 'permanent',
        provisionRunId: provisionRunId,
      }),
    });

    assert(res.status === 409, `Expected 409 conflict, got ${res.status}: ${await res.text()}`);
    return 'Mapping override after lock correctly rejected with 409';
  });

  // ── Step 21: Post-Lock Package Export (comprehensive assertions) ──
  await runStep('21. Post-Lock Package Export (GET /results/:id/package)', async () => {
    const res = await app.request(`/api/provision/results/${resultId}/package`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    // 20a. HTTP 200
    assert(res.status === 200, `Expected status 200, got ${res.status}`);

    // 20b. Content-Type
    const contentType = res.headers.get('Content-Type');
    assert(contentType?.includes('application/zip') ?? false, `Expected Content-Type application/zip, got ${contentType}`);

    // 20c. ZIP magic bytes
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert(bytes.length > 200, `Zip buffer too small (${bytes.length} bytes)`);
    assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'Invalid ZIP magic header signature');

    // 20d-e. Parse ZIP entries and verify manifest
    const entries = parseZipEntries(bytes);
    assert(entries.has('manifest.json'), 'Package must contain manifest.json');

    // 20f. Parse manifest
    const manifestEntry = entries.get('manifest.json')!;
    const manifestText = new TextDecoder().decode(manifestEntry.data);
    const manifest = JSON.parse(manifestText);
    assert(manifest.schemaVersion === '1.0.0', `Expected schemaVersion 1.0.0, got ${manifest.schemaVersion}`);
    assert(!!manifest.sourceHash, 'Manifest must have sourceHash');
    assert(!!manifest.mappingVersionHash, 'Manifest must have mappingVersionHash');
    assert(!!manifest.engineVersion, 'Manifest must have engineVersion');
    assert(!!manifest.mode, 'Manifest must have mode');

    // 20g. Verify file hashes
    for (const file of manifest.files) {
      const entry = entries.get(file.name);
      assert(entry, `Manifest references '${file.name}' but it's missing from ZIP`);
      const actualHash = sha256(entry.data);
      assert(actualHash === file.sha256, `Hash mismatch for '${file.name}': manifest=${file.sha256}, actual=${actualHash}`);
    }

    // 20h. Verify fileCount
    const contentFileCount = Array.from(entries.keys()).filter(n => n !== 'manifest.json').length;
    assert(manifest.fileCount === contentFileCount, `Manifest fileCount ${manifest.fileCount} != actual content files ${contentFileCount}`);

    // 20i-l. Verify required files exist
    assert(entries.has('review-items.csv'), 'Package must contain review-items.csv');
    assert(entries.has('ai-traces.csv'), 'Package must contain ai-traces.csv');
    assert(entries.has('approval-trail.json'), 'Package must contain approval-trail.json');
    assert(entries.has('assumptions.json'), 'Package must contain assumptions.json');

    // 20m. Verify approval trail contains approved/locked status
    const approvalData = JSON.parse(new TextDecoder().decode(entries.get('approval-trail.json')!.data));
    const statusValid = approvalData.approvalStatus === 'approved' || approvalData.approvalStatus === 'locked';
    assert(statusValid, `Approval trail should be approved or locked, got ${approvalData.approvalStatus}`);

    // 20n. Summary file exists
    const summaryEntry = Array.from(entries.keys()).find((n: string) => n.startsWith('provision-') && n.endsWith('.xlsx'));
    if (!summaryEntry) {
      const packages = Array.from(entries.keys()).filter((n: string) => n.includes('package-summary'));
      assert(packages.length > 0, 'Package must contain provision XLSX or package-summary');
    }

    // 20o. Verify export.package audit event (checked later in Step 21/22)

    return `Post-lock ZIP: ${bytes.length.toLocaleString()} bytes, ${contentFileCount} content files, manifest verifies all hashes`;
  });

  // ── Step 22: Audit trail captures the governance lifecycle ──
  await runStep('22. Audit Trail (GET /runs/:id/events)', async () => {
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

  // ── Step 23: Verify mapping.override + export.package audit events ──
  await runStep('23. Verify Mapping Override & Export Audit Events', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/events`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
    const events = await res.json();
    const types = (events as any[]).map((e) => e.eventType);
    assert(types.includes('mapping.override'), 'Missing mapping.override audit event');
    assert(types.includes('export.package'), 'Missing export.package audit event');
    return `Audit events contain mapping.override + export.package`;
  });

  // ── Step 24: Create foreign tenant ──
  let foreignToken = '';
  await runStep('24. Create Foreign Tenant (POST /api/auth/register)', async () => {
    const suffix = Date.now().toString(36);
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `iso-${suffix}@test.local`,
        password: 'Password123!',
        tenantName: 'Isolation Test',
        tenantSlug: `iso-${suffix}`,
      }),
    });
    assert(res.status === 201, `Foreign tenant registration failed: ${res.status}`);
    const reg = await res.json();
    foreignToken = reg.token;
    return `Foreign tenant created: iso-${suffix}`;
  });

  const foreignHeaders = { 'Authorization': `Bearer ${foreignToken}` };

  // ── Step 25: Cross-tenant isolation ──
  await runStep('25. Tenant Isolation (cross-tenant access blocked)', async () => {
    // 24a. Review items
    const itemsRes = await app.request(`/api/provision/runs/${provisionRunId}/review-items`, { headers: foreignHeaders });
    assert(itemsRes.status === 200, `Expected 200, got ${itemsRes.status}`);
    const items = await itemsRes.json();
    assert(Array.isArray(items) && items.length === 0, 'Foreign tenant must not see demo review items');

    // 24b. Package export
    const pkgRes = await app.request(`/api/provision/results/${resultId}/package`, { headers: foreignHeaders });
    assert(pkgRes.status !== 200, 'Foreign tenant must not access demo export package');

    // 24c. Mappings
    const mapRes = await app.request('/api/mapping/mappings', { headers: foreignHeaders });
    assert(mapRes.status === 200, `Expected 200 for mappings, got ${mapRes.status}`);
    const foreignMappings = await mapRes.json();
    assert(Array.isArray(foreignMappings) && foreignMappings.length === 0, 'Foreign tenant must not see demo mappings');

    // 24d. Import export
    const importRes = await app.request('/api/import/trial-balance/export', { headers: foreignHeaders });
    assert(importRes.status === 200, `Expected 200 for import export, got ${importRes.status}`);
    const foreignImportCsv = await importRes.text();
    assert(!foreignImportCsv.includes(importedAccountName), 'Foreign tenant must not see demo import data');

    return `Foreign tenant blocked from: items(${items.length}), package(HTTP ${pkgRes.status}), mappings(${foreignMappings.length}), import data`;
  });

  // ── Step 26: Verify no pending agents ──
  await runStep('26. Verify No Pending Agents', async () => {
    const res = await app.request(`/api/provision/runs/${provisionRunId}/ai-findings`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const data = await res.json();
    assert(data.pending === false, `Expected pending=false, got pending=${data.pending}`);
    const nonTerminal = (data.agents ?? []).filter((a: any) => !TERMINAL_STATES.has(a.status));
    assert(nonTerminal.length === 0, `${nonTerminal.length} agent(s) still not in terminal state: ${nonTerminal.map((a: any) => `${a.workflowName}:${a.status}`).join(', ')}`);
    return `All agents in terminal state, pending=false`;
  });

  // ── Summary ──
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
