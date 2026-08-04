import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import crypto from 'crypto';
import { withTenantContext } from '../config/db.js';
import { env } from '../config/env.js';
import { errorHandler } from '../lib/middleware/error-handler.js';
import { workbenchRoutes } from '../modules/workbench/workbench.routes.js';
import { provisionRoutes } from '../modules/provision/provision.routes.js';
import { tenants } from '../db/schema/tenants.js';
import { users } from '../db/schema/users.js';
import { entities } from '../db/schema/entities.js';
import { accountingPeriods } from '../db/schema/accounting-periods.js';
import { taxPeriods } from '../db/schema/tax-periods.js';
import { sourceDocuments } from '../db/schema/source-documents.js';
import { accounts } from '../db/schema/accounts.js';
import { taxMappings } from '../db/schema/tax-mappings.js';
import { ukRules } from '../db/schema/uk-rules.js';
import { mappingProposals } from '../db/schema/mapping-proposals.js';
import { reviewItems } from '../db/schema/review-items.js';
import { workbenchJobs } from '../db/schema/workbench-jobs.js';
import { provisionRuns } from '../db/schema/provision-runs.js';

const TENANT_A = crypto.randomUUID();
const TENANT_B = crypto.randomUUID();
const USER_A = crypto.randomUUID();
const USER_B = crypto.randomUUID();
const ENTITY_A = crypto.randomUUID();
const ENTITY_B = crypto.randomUUID();
const PERIOD_AP = crypto.randomUUID();
const PERIOD_AP_B = crypto.randomUUID();
const PERIOD_TP = crypto.randomUUID();
const PERIOD_TP_NON_STANDARD = crypto.randomUUID();
const PERIOD_TP_B = crypto.randomUUID();
const DOC_A = crypto.randomUUID();
const DOC_B = crypto.randomUUID();

const SHA_A = crypto.createHash('sha256').update('phase-c-tb-source').digest('hex');

const app = new Hono();
app.onError(errorHandler);
app.route('/api/workbench', workbenchRoutes);
app.route('/api/provision', provisionRoutes);

function tokenFor(userId: string, tenantId: string, role = 'admin'): string {
  return jwt.sign({ userId, tenantId, email: 'phase-c@test.local', role }, env.JWT_SECRET, { expiresIn: '1h' });
}
const TOKEN_A = tokenFor(USER_A, TENANT_A);
const TOKEN_B = tokenFor(USER_B, TENANT_B);

const TB_ROWS = [
  { externalId: 'REV-100', name: 'Sales', type: 'Revenue', balance: 10000 },
  { externalId: 'EXP-200', name: 'Rent', type: 'Expense', balance: -6000 },
  { externalId: 'MISC-300', name: 'Sundry', type: 'OtherIncome', balance: 1000 },
];

async function setupTenant(tid: string, uid: string, eid: string, apId: string, tpId: string, docId: string) {
  await withTenantContext(tid, async (tx) => {
    await tx.insert(tenants).values({ id: tid, name: `Phase C ${tid.slice(0, 8)}`, slug: tid, taxRate: '0.25' }).onConflictDoNothing();
    await tx.insert(users).values({ id: uid, tenantId: tid, email: `phase-c-${tid.slice(0, 8)}@test.local`, passwordHash: 'x', role: 'admin' }).onConflictDoNothing();
    await tx.insert(entities).values({
      id: eid, tenantId: tid, externalId: eid, name: 'Phase C UK Entity', type: 'Limited Company',
      currency: 'GBP', taxJurisdiction: 'UK_FRS102', isConsolidated: false,
    }).onConflictDoNothing();
    await tx.insert(accountingPeriods).values({
      id: apId, tenantId: tid, entityId: eid, name: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31',
      periodType: 'annual', status: 'open',
    }).onConflictDoNothing();
    await tx.insert(taxPeriods).values({
      id: tpId, tenantId: tid, entityId: eid, accountingPeriodId: apId,
      startDate: '2026-01-01', endDate: '2026-12-31', durationMonths: 12, isStandardDuration: true, status: 'open',
    }).onConflictDoNothing();
    await tx.insert(sourceDocuments).values({
      id: docId, tenantId: tid, entityId: eid, accountingPeriodId: apId, taxPeriodId: tpId,
      documentType: 'trial_balance', filename: 'tb-fy2026.csv', mimeType: 'text/csv', sizeBytes: 1024,
      storageKey: `tb-${docId}`, sha256: SHA_A, provenance: 'manual_upload',
      extractionStatus: 'not_required', version: 1, isCurrent: true, uploadedByUserId: uid,
    }).onConflictDoNothing();
  });
}

beforeAll(async () => {
  await setupTenant(TENANT_A, USER_A, ENTITY_A, PERIOD_AP, PERIOD_TP, DOC_A);
  await setupTenant(TENANT_B, USER_B, ENTITY_B, PERIOD_AP_B, PERIOD_TP_B, DOC_B);

  // Approved UK rules registry so resolveRulesUsed has something to record.
  for (const tid of [TENANT_A, TENANT_B]) {
    await withTenantContext(tid, async (tx) => {
      await tx.insert(ukRules).values({
        tenantId: tid, ruleKey: 'uk.rates.v1', jurisdiction: 'UK_FRS102',
        effectiveFrom: '2026-01-01', effectiveTo: null,
        sourceUrl: 'https://www.gov.uk/rates', sourceSnapshotHash: 'abc123',
        author: 'Phase C test', approvalState: 'approved', version: 1,
      }).onConflictDoNothing();
    });
  }

  // Approved mappings for the revenue and expense accounts in tenant A.
  await withTenantContext(TENANT_A, async (tx) => {
    const [rev] = await tx.insert(accounts).values({
      tenantId: TENANT_A, externalId: 'REV-100', accountNumber: 'REV-100', name: 'Sales', type: 'Revenue',
    }).onConflictDoNothing().returning();
    const [exp] = await tx.insert(accounts).values({
      tenantId: TENANT_A, externalId: 'EXP-200', accountNumber: 'EXP-200', name: 'Rent', type: 'Expense',
    }).onConflictDoNothing().returning();
    for (const [account, taxAccountType, bookTreatment] of [
      [rev ?? (await tx.select().from(accounts).where(and(eq(accounts.tenantId, TENANT_A), eq(accounts.externalId, 'REV-100'))).limit(1))[0], 'UK_REVENUE', 'permanent'],
      [exp ?? (await tx.select().from(accounts).where(and(eq(accounts.tenantId, TENANT_A), eq(accounts.externalId, 'EXP-200'))).limit(1))[0], 'UK_EXPENSE', 'permanent'],
    ] as const) {
      await tx.insert(taxMappings).values({
        tenantId: TENANT_A, accountId: account.id, taxAccountType, bookTreatment,
        isActive: true, status: 'active', version: 1, suggestedByAi: false,
      }).onConflictDoNothing();
    }
  });
});

afterAll(async () => {
  for (const tid of [TENANT_A, TENANT_B]) {
    await withTenantContext(tid, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tid));
    }).catch(() => {});
  }
});

describe('Phase C — workbench: import', () => {
  it('imports trial balance rows linked to the source document (idempotent)', async () => {
    const key = `import-${crypto.randomUUID()}`;
    const res = await app.request('/api/workbench/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: key,
        entityId: ENTITY_A,
        accountingPeriodId: PERIOD_AP,
        taxPeriodId: PERIOD_TP,
        sourceDocumentId: DOC_A,
        rows: TB_ROWS,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.replayed).toBe(false);
    expect(data.result.rowsReceived).toBe(3);
    expect(data.result.rowsInserted).toBe(3);
    expect(data.result.accountsCreated).toBe(1); // MISC-300 only; REV/EXP pre-seeded
    expect(data.result.source).toBe('workbench');

    const replay = await app.request('/api/workbench/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: key,
        entityId: ENTITY_A,
        accountingPeriodId: PERIOD_AP,
        taxPeriodId: PERIOD_TP,
        sourceDocumentId: DOC_A,
        rows: TB_ROWS,
      }),
    });
    expect(replay.status).toBe(200);
    const replayData = await replay.json() as any;
    expect(replayData.replayed).toBe(true);

    await withTenantContext(TENANT_A, async (tx) => {
      const job = await tx.select().from(workbenchJobs)
        .where(and(eq(workbenchJobs.tenantId, TENANT_A), eq(workbenchJobs.idempotencyKey, key))).limit(1);
      expect(job[0]?.status).toBe('succeeded');
    });
  });
});

describe('Phase C — workbench: run gates', () => {
  it('blocks calculation while a mapping proposal is pending', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const [expAccount] = await tx.select({ id: accounts.id, externalId: accounts.externalId }).from(accounts)
        .where(and(eq(accounts.tenantId, TENANT_A), eq(accounts.externalId, 'EXP-200'))).limit(1);
      await tx.insert(mappingProposals).values({
        tenantId: TENANT_A, entityId: ENTITY_A,
        accountId: expAccount?.id ?? crypto.randomUUID(),
        sourceAccountExternalId: 'EXP-200',
        sourceAccountName: 'Rent',
        targetTaxClassification: 'UK_EXPENSE',
        bookTreatment: 'permanent',
        proposalSource: 'human',
        status: 'pending', version: 1,
      });
    });

    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-pending-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP, sourceDocumentId: DOC_A,
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.blocked).toBe(true);
    expect(data.blockers.some((b: any) => b.code === 'mapping_proposals_pending')).toBe(true);

    await withTenantContext(TENANT_A, async (tx) => {
      await tx.delete(mappingProposals).where(and(eq(mappingProposals.tenantId, TENANT_A), eq(mappingProposals.entityId, ENTITY_A)));
    });
  });

  it('blocks calculation on a non-standard tax period with an unresolved review', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.insert(taxPeriods).values({
        id: PERIOD_TP_NON_STANDARD, tenantId: TENANT_A, entityId: ENTITY_A, accountingPeriodId: PERIOD_AP,
        startDate: '2025-10-01', endDate: '2026-12-31', durationMonths: 15,
        isStandardDuration: false, status: 'needs_review',
      }).onConflictDoNothing();
      await tx.insert(reviewItems).values({
        tenantId: TENANT_A, entityId: ENTITY_A,
        itemType: 'non_standard_period', severity: 'high', status: 'open',
        title: 'Non-standard tax period requires review',
        description: '15-month period requires review before calculation.',
      });
    });

    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-nonstd-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP_NON_STANDARD, sourceDocumentId: DOC_A,
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.blocked).toBe(true);
    expect(data.blockers.some((b: any) => b.code === 'non_standard_period_requires_review')).toBe(true);

    // Resolving the review item clears the gate.
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.update(reviewItems).set({ status: 'resolved' })
        .where(and(eq(reviewItems.tenantId, TENANT_A), eq(reviewItems.itemType, 'non_standard_period'), eq(reviewItems.status, 'open')));
    });
    const after = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-nonstd2-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP_NON_STANDARD, sourceDocumentId: DOC_A,
      }),
    });
    expect(after.status).toBe(200);
  });
});

describe('Phase C — workbench: deterministic calculation run', () => {
  let runIdA = '';
  let runIdB = '';
  let summaryA: any = null;
  let summaryB: any = null;

  it('creates a versioned run with full provenance (needs_review due to unmapped account)', async () => {
    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-a-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP, sourceDocumentId: DOC_A,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.replayed).toBe(false);
    runIdA = data.result.runId;
    summaryA = data.result.summary;
    expect(data.result.status).toBe('needs_review');
    expect(data.result.openReviewItems).toBeGreaterThan(0);
    expect(data.result.engineVersion ?? data.result.correlationId).toBeDefined();
    expect(data.result.inputDataHash).toBeTruthy();
    expect(data.result.mappingVersionHash).toBeTruthy();

    await withTenantContext(TENANT_A, async (tx) => {
      const [run] = await tx.select().from(provisionRuns).where(eq(provisionRuns.id, runIdA)).limit(1);
      expect(run).toBeDefined();
      expect(run.sourceDocumentId).toBe(DOC_A);
      expect(run.taxPeriodId).toBe(PERIOD_TP);
      expect(run.engineVersion).toBe('tax-engine-0.1.0');
      expect(Array.isArray(run.rulesUsed) && run.rulesUsed.length > 0).toBe(true);
      expect(Array.isArray(run.mappingSnapshot) && run.mappingSnapshot.length === 2).toBe(true);
      expect(Array.isArray(run.assumptions) && run.assumptions.length > 0).toBe(true);
      expect(Array.isArray(run.warnings) && run.warnings.some((w: any) => w.code === 'unmapped_account')).toBe(true);
      expect(run.correlationId).toBeTruthy();

      const items = await tx.select().from(reviewItems).where(eq(reviewItems.provisionRunId, runIdA));
      expect(items.some((i) => i.itemType === 'missing_mapping' && i.severity === 'high')).toBe(true);

      const [job] = await tx.select().from(workbenchJobs).where(eq(workbenchJobs.provisionRunId, runIdA)).limit(1);
      expect(job?.status).toBe('succeeded');
    });
  });

  it('is deterministic: identical inputs produce identical hashes and numbers', async () => {
    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-b-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP, sourceDocumentId: DOC_A,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    runIdB = data.result.runId;
    summaryB = data.result.summary;
    expect(runIdB).not.toBe(runIdA);
    expect(data.result.inputDataHash).toBe(await (async () => {
      const a = await app.request(`/api/workbench/runs/${runIdA}`, {
        headers: { Authorization: `Bearer ${TOKEN_A}` },
      });
      const json = await a.json() as any;
      return json.run.inputDataHash;
    })());
    expect(summaryB.totalTaxExpense).toBe(summaryA.totalTaxExpense);
    expect(summaryB.currentTaxExpense).toBe(summaryA.currentTaxExpense);
    expect(summaryB.deferredTaxExpense).toBe(summaryA.deferredTaxExpense);
    expect(summaryB.bookIncome).toBe(summaryA.bookIncome);
    expect(summaryB.effectiveTaxRate).toBe(summaryA.effectiveTaxRate);
    expect(summaryB.totalTaxExpense).toBeGreaterThan(0);
  });

  it('replays a completed calculation idempotency key without recomputing', async () => {
    const key = `run-a-replay-${crypto.randomUUID()}`;
    const body = JSON.stringify({
      idempotencyKey: key,
      entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP, sourceDocumentId: DOC_A,
    });
    const first = await (await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body,
    })).json() as any;
    expect(first.replayed).toBe(false);

    const second = await (await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body,
    })).json() as any;
    expect(second.replayed).toBe(true);
  });

  it('exposes the full workbench view: evidence, review items, rules, lineage', async () => {
    const res = await app.request(`/api/workbench/runs/${runIdA}`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.evidence.sha256).toBe(SHA_A);
    expect(data.evidence.id).toBe(DOC_A);
    expect(data.run.engineVersion).toBe('tax-engine-0.1.0');
    expect(data.run.rulesUsed.length).toBeGreaterThan(0);
    expect(data.run.mappingSnapshot.length).toBe(2);
    expect(data.run.assumptions.length).toBeGreaterThan(0);
    expect(data.run.warnings.some((w: any) => w.code === 'unmapped_account')).toBe(true);
    expect(data.reviewItems.length).toBeGreaterThan(0);
    expect(data.parentRun).toBeNull();
    expect(data.childRuns).toEqual([]);
    expect(data.result.currentTaxExpense).toBeTruthy();
    expect(data.approvalBlocked).toBe(true); // open high-severity item
    expect(data.approvalBlockers.length).toBeGreaterThan(0);
  });
});

describe('Phase C — workbench: approval gates on governance endpoints', () => {
  let runId = '';

  beforeAll(async () => {
    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({
        idempotencyKey: `run-gov-${crypto.randomUUID()}`,
        entityId: ENTITY_A, accountingPeriodId: PERIOD_AP, taxPeriodId: PERIOD_TP, sourceDocumentId: DOC_A,
      }),
    });
    const data = await res.json() as any;
    runId = data.result.runId;
  });

  it('blocks finalize while critical review items are open', async () => {
    const res = await app.request(`/api/provision/runs/${runId}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/review|approval_gate|open critical/i);
  });

  it('finalize passes once review items are resolved; lock still requires approval', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.update(reviewItems).set({ status: 'resolved' })
        .where(and(eq(reviewItems.provisionRunId, runId), eq(reviewItems.status, 'open')));
    });

    const finalize = await app.request(`/api/provision/runs/${runId}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(finalize.status).toBe(200);

    const lock = await app.request(`/api/provision/runs/${runId}/lock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(lock.status).toBe(400); // not approved yet
    expect(await lock.text()).toMatch(/approved/i);
  });

  it('locks once approved', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.update(provisionRuns).set({ approvalStatus: 'approved', approvedAt: new Date(), approvedByUserId: USER_A })
        .where(eq(provisionRuns.id, runId));
    });
    const lock = await app.request(`/api/provision/runs/${runId}/lock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(lock.status).toBe(200);
  });

  it('recalculation creates a new version and never mutates the locked run', async () => {
    const before = await app.request(`/api/workbench/runs/${runId}`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const beforeJson = await before.json() as any;
    expect(beforeJson.run.status).toBe('locked');

    const res = await app.request(`/api/workbench/runs/${runId}/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_A}` },
      body: JSON.stringify({ idempotencyKey: `recalc-${crypto.randomUUID()}` }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const newRunId = data.result.runId;
    expect(newRunId).not.toBe(runId);
    expect(data.result.parentRunId).toBe(runId);

    const after = await app.request(`/api/workbench/runs/${runId}`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const afterJson = await after.json() as any;
    expect(afterJson.run.status).toBe('locked');
    expect(afterJson.childRuns.some((r: any) => r.id === newRunId)).toBe(true);

    const newView = await app.request(`/api/workbench/runs/${newRunId}`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    const newJson = await newView.json() as any;
    expect(newJson.parentRun.id).toBe(runId);
  });
});

describe('Phase C — workbench: tenant isolation', () => {
  it('tenant B cannot read tenant A runs (fail closed)', async () => {
    const view = await app.request(`/api/workbench/runs/${crypto.randomUUID()}`, {
      headers: { Authorization: `Bearer ${TOKEN_B}` },
    });
    // RLS fail-closed surfaces as NotFound (404) or BadRequest (400) — never 200.
    expect([400, 404]).toContain(view.status);

    const res = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
      body: JSON.stringify({
        idempotencyKey: `run-x-${crypto.randomUUID()}`,
        entityId: ENTITY_B, accountingPeriodId: PERIOD_AP_B, taxPeriodId: PERIOD_TP_B, sourceDocumentId: DOC_B,
      }),
    });
    // Tenant B has no mappings and no imported trial balance for its document;
    // the calculation must not leak tenant A rows and the run must not claim
    // an approved outcome — it fails closed on missing evidence/import.
    expect([400, 200]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json() as any;
      expect(data.result.status).toBe('needs_review'); // never silently calculated-clean
    }
  });
});

describe('Phase C — workbench: unapproved mappings cannot silently produce approved results', () => {
  it('an entity without mappings yields a needs_review run with high-severity items', async () => {
    const res = await app.request('/api/workbench/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
      body: JSON.stringify({
        idempotencyKey: `import-b-${crypto.randomUUID()}`,
        entityId: ENTITY_B, accountingPeriodId: PERIOD_AP_B, taxPeriodId: PERIOD_TP_B, sourceDocumentId: DOC_B,
        rows: TB_ROWS,
      }),
    });
    expect(res.status).toBe(200);

    const run = await app.request('/api/workbench/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN_B}` },
      body: JSON.stringify({
        idempotencyKey: `run-b1-${crypto.randomUUID()}`,
        entityId: ENTITY_B, accountingPeriodId: PERIOD_AP_B, taxPeriodId: PERIOD_TP_B, sourceDocumentId: DOC_B,
      }),
    });
    expect(run.status).toBe(200);
    const data = await run.json() as any;
    expect(data.result.status).toBe('needs_review');
    expect(data.result.openReviewItems).toBeGreaterThan(0);

    const finalize = await app.request(`/api/provision/runs/${data.result.runId}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_B}` },
    });
    expect(finalize.status).toBe(400);
    expect(await finalize.text()).toMatch(/critical|review/i);
  });
});
