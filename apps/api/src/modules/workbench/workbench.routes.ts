// ─────────────────────────────────────────────────────────────────────────────
// Phase C — UK Tax-Close Workbench API.
//
// Operational surface for the deterministic UK workbench flow:
//   setup (tenant metadata) → import (idempotent, evidence-linked) →
//   run (gated, deterministic, versioned) → view (full provenance) →
//   recalculate (new version only, never mutate) → blockers (gate status).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { requireRole, requireRunAccess } from '../../lib/middleware/rbac.js';
import { BadRequestError } from '../../lib/errors.js';
import { entities } from '../../db/schema/entities.js';
import { accountingPeriods } from '../../db/schema/accounting-periods.js';
import { taxPeriods } from '../../db/schema/tax-periods.js';
import { sourceDocuments } from '../../db/schema/source-documents.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { provisionResults } from '../../db/schema/provision-results.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { createWorkbenchJob, executeWorkbenchJob, logJobFailure, WORKBENCH_JOB_TYPES } from './jobs.js';
import { runTrialBalanceImport, runWorkbenchCalculationJob, type WorkbenchCalculationPayload } from './operations.js';
import { evaluateRunCreationGates, assertWorkbenchApprovalGates } from './guard.js';

export const workbenchRoutes = new Hono();
workbenchRoutes.use('*', authMiddleware);

const idempotencyKeySchema = z.string().min(8).max(128);
const referenceIdsSchema = z.object({
  entityId: z.string().uuid(),
  accountingPeriodId: z.string().uuid(),
  taxPeriodId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
});

const importSchema = referenceIdsSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  rows: z.array(z.object({
    externalId: z.string().min(1).max(100),
    name: z.string().min(1).max(255),
    type: z.string().min(1).max(50),
    detailType: z.string().max(100).optional(),
    balance: z.number(),
    placedInServiceDate: z.string().nullable().optional(),
  })).min(1).max(5000),
});

const runSchema = referenceIdsSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});

const recalcSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});

// ── Setup: tenant-scoped pickers ───────────────────────────────────────────

workbenchRoutes.get('/setup', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const [entityList, periodList, taxPeriodList, documentList, runList] = await Promise.all([
      tx.select({
        id: entities.id, name: entities.name, type: entities.type,
        currency: entities.currency, taxJurisdiction: entities.taxJurisdiction,
      }).from(entities).where(eq(entities.tenantId, user.tenantId)).orderBy(entities.name),
      tx.select().from(accountingPeriods).where(eq(accountingPeriods.tenantId, user.tenantId)).orderBy(desc(accountingPeriods.endDate)),
      tx.select().from(taxPeriods).where(eq(taxPeriods.tenantId, user.tenantId)).orderBy(desc(taxPeriods.endDate)),
      tx.select().from(sourceDocuments)
        .where(and(eq(sourceDocuments.tenantId, user.tenantId), eq(sourceDocuments.isCurrent, true)))
        .orderBy(desc(sourceDocuments.createdAt)),
      tx.select({
        id: provisionRuns.id, period: provisionRuns.period, endPeriod: provisionRuns.endPeriod,
        entityId: provisionRuns.entityId, status: provisionRuns.status,
        approvalStatus: provisionRuns.approvalStatus, createdAt: provisionRuns.createdAt,
      }).from(provisionRuns).where(eq(provisionRuns.tenantId, user.tenantId))
        .orderBy(desc(provisionRuns.createdAt)),
    ]);
    return c.json({ entities: entityList, accountingPeriods: periodList, taxPeriods: taxPeriodList, documents: documentList, recentRuns: runList });
  });
});

// ── Import: idempotent trial balance import linked to a source document ────

workbenchRoutes.post('/import',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', importSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const correlationId = crypto.randomUUID();

    return withTenantContext(user.tenantId, async (tx) => {
      const { job, created } = await createWorkbenchJob(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        jobType: WORKBENCH_JOB_TYPES.TRIAL_BALANCE_IMPORT,
        idempotencyKey: body.idempotencyKey,
        payload: {
          tenantId: user.tenantId,
          userId: user.userId,
          entityId: body.entityId,
          accountingPeriodId: body.accountingPeriodId,
          taxPeriodId: body.taxPeriodId,
          sourceDocumentId: body.sourceDocumentId,
          rows: body.rows,
          correlationId,
        },
        correlationId,
      });

      if (!created) {
        return c.json({ jobId: job.id, replayed: true, status: job.status, result: job.result ?? null });
      }

      try {
        const result = await executeWorkbenchJob(tx, job, runTrialBalanceImport);
        return c.json({ jobId: job.id, replayed: false, status: 'succeeded', result });
      } catch (err) {
        logJobFailure(WORKBENCH_JOB_TYPES.TRIAL_BALANCE_IMPORT, job.id, err);
        throw err;
      }
    });
  });

// ── Run: gated, deterministic, versioned calculation ───────────────────────

workbenchRoutes.post('/runs',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', runSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const correlationId = crypto.randomUUID();

    return withTenantContext(user.tenantId, async (tx) => {
      const gateResult = await evaluateRunCreationGates(tx, user.tenantId, {
        entityId: body.entityId,
        taxPeriodId: body.taxPeriodId,
        sourceDocumentId: body.sourceDocumentId,
      });
      if (gateResult.blocked) {
        return c.json({ blocked: true, blockers: gateResult.blockers, warnings: gateResult.warnings }, 400);
      }

      const { job, created } = await createWorkbenchJob(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        jobType: WORKBENCH_JOB_TYPES.PROVISION_CALCULATION,
        idempotencyKey: body.idempotencyKey,
        payload: {
          tenantId: user.tenantId,
          userId: user.userId,
          entityId: body.entityId,
          accountingPeriodId: body.accountingPeriodId,
          taxPeriodId: body.taxPeriodId,
          sourceDocumentId: body.sourceDocumentId,
          correlationId,
        },
        correlationId,
      });

      if (!created) {
        return c.json({ jobId: job.id, replayed: true, status: job.status, result: job.result ?? null });
      }

      try {
        const result = await executeWorkbenchJob(tx, job, runWorkbenchCalculationJob);
        return c.json({ jobId: job.id, replayed: false, status: 'succeeded', result });
      } catch (err) {
        logJobFailure(WORKBENCH_JOB_TYPES.PROVISION_CALCULATION, job.id, err);
        throw err;
      }
    });
  });

// ── View: full workbench provenance for a run ──────────────────────────────

workbenchRoutes.get('/runs/:id', async (c) => {
  const user = c.get('user');
  const runId = c.req.param('id');

  return withTenantContext(user.tenantId, async (tx) => {
    await requireRunAccess(runId, user.tenantId, tx);

    const [run] = await tx.select().from(provisionRuns)
      .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
    if (!run) throw new BadRequestError('Provision run not found');

    const [result] = run.resultId
      ? await tx.select().from(provisionResults).where(and(eq(provisionResults.id, run.resultId), eq(provisionResults.tenantId, user.tenantId))).limit(1)
      : [];

    const items = await tx.select().from(reviewItems)
      .where(and(eq(reviewItems.tenantId, user.tenantId), eq(reviewItems.provisionRunId, runId)))
      .orderBy(reviewItems.createdAt);

    const [document] = run.sourceDocumentId
      ? await tx.select({
        id: sourceDocuments.id, filename: sourceDocuments.filename, documentType: sourceDocuments.documentType,
        sha256: sourceDocuments.sha256, extractionStatus: sourceDocuments.extractionStatus,
        version: sourceDocuments.version, isCurrent: sourceDocuments.isCurrent,
      }).from(sourceDocuments)
        .where(and(eq(sourceDocuments.tenantId, user.tenantId), eq(sourceDocuments.id, run.sourceDocumentId))).limit(1)
      : [];

    const [entity] = run.entityId
      ? await tx.select({ id: entities.id, name: entities.name, taxJurisdiction: entities.taxJurisdiction, currency: entities.currency })
        .from(entities).where(and(eq(entities.tenantId, user.tenantId), eq(entities.id, run.entityId))).limit(1)
      : [];

    const [parentRun] = run.parentRunId
      ? await tx.select({ id: provisionRuns.id, period: provisionRuns.period, status: provisionRuns.status, createdAt: provisionRuns.createdAt })
        .from(provisionRuns).where(eq(provisionRuns.id, run.parentRunId)).limit(1)
      : [];

    const childRuns = await tx.select({ id: provisionRuns.id, status: provisionRuns.status, createdAt: provisionRuns.createdAt })
      .from(provisionRuns).where(and(eq(provisionRuns.tenantId, user.tenantId), eq(provisionRuns.parentRunId, runId)));

    let approvalBlocked = false;
    let approvalBlockers: { code: string; message: string }[] = [];
    try {
      await assertWorkbenchApprovalGates(tx, user.tenantId, run);
    } catch (err) {
      approvalBlocked = true;
      approvalBlockers = [{ code: 'approval_gate', message: err instanceof Error ? err.message : String(err) }];
    }

    return c.json({
      run: {
        id: run.id,
        period: run.period,
        endPeriod: run.endPeriod,
        entityId: run.entityId,
        status: run.status,
        approvalStatus: run.approvalStatus,
        engineVersion: run.engineVersion,
        inputDataHash: run.inputDataHash,
        mappingVersionHash: run.mappingVersionHash,
        rulesUsed: run.rulesUsed,
        mappingSnapshot: run.mappingSnapshot,
        assumptions: run.assumptions,
        warnings: run.warnings,
        correlationId: run.correlationId,
        idempotencyKey: run.idempotencyKey,
        parentRunId: run.parentRunId,
        sourceDocumentId: run.sourceDocumentId,
        accountingPeriodId: run.accountingPeriodId,
        taxPeriodId: run.taxPeriodId,
        exceptionSummary: run.exceptionSummary,
        submittedAt: run.submittedAt,
        approvedAt: run.approvedAt,
        lockedAt: run.lockedAt,
        createdAt: run.createdAt,
      },
      result,
      reviewItems: items,
      evidence: document ?? null,
      entity,
      parentRun: parentRun ?? null,
      childRuns,
      approvalBlocked,
      approvalBlockers,
    });
  });
});

// ── Recalculate: never mutate — always a new run version ───────────────────

workbenchRoutes.post('/runs/:id/recalculate',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', recalcSchema),
  async (c) => {
    const user = c.get('user');
    const { id: runId } = c.req.param();
    const body = c.req.valid('json');
    const correlationId = crypto.randomUUID();

    return withTenantContext(user.tenantId, async (tx) => {
      await requireRunAccess(runId, user.tenantId, tx);
      const [run] = await tx.select().from(provisionRuns)
        .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
      if (!run) throw new BadRequestError('Provision run not found');
      if (!run.sourceDocumentId || !run.accountingPeriodId || !run.taxPeriodId) {
        throw new BadRequestError('This run is not a workbench run; recalculation requires a run created through the workbench.');
      }

      const gateResult = await evaluateRunCreationGates(tx, user.tenantId, {
        entityId: run.entityId!,
        taxPeriodId: run.taxPeriodId,
        sourceDocumentId: run.sourceDocumentId,
      });
      if (gateResult.blocked) {
        return c.json({ blocked: true, blockers: gateResult.blockers, warnings: gateResult.warnings }, 400);
      }

      const payload: WorkbenchCalculationPayload & { tenantId: string; userId: string; correlationId: string } = {
        tenantId: user.tenantId,
        userId: user.userId,
        entityId: run.entityId!,
        accountingPeriodId: run.accountingPeriodId,
        taxPeriodId: run.taxPeriodId,
        sourceDocumentId: run.sourceDocumentId,
        parentRunId: run.id,
        correlationId,
      };

      const { job, created } = await createWorkbenchJob(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        jobType: WORKBENCH_JOB_TYPES.PROVISION_RECALCULATION,
        idempotencyKey: body.idempotencyKey,
        payload,
        correlationId,
      });

      if (!created) {
        return c.json({ jobId: job.id, replayed: true, status: job.status, result: job.result ?? null });
      }

      try {
        const result = await executeWorkbenchJob(tx, job, runWorkbenchCalculationJob);
        return c.json({ jobId: job.id, replayed: false, status: 'succeeded', result });
      } catch (err) {
        logJobFailure(WORKBENCH_JOB_TYPES.PROVISION_RECALCULATION, job.id, err);
        throw err;
      }
    });
  });

// ── Gate status for a run (approval blockers) ──────────────────────────────

workbenchRoutes.get('/runs/:id/blockers', async (c) => {
  const user = c.get('user');
  const runId = c.req.param('id');

  return withTenantContext(user.tenantId, async (tx) => {
    const [run] = await tx.select().from(provisionRuns)
      .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
    if (!run) throw new BadRequestError('Provision run not found');

    let blocked = false;
    let blockers: { code: string; message: string }[] = [];
    try {
      await assertWorkbenchApprovalGates(tx, user.tenantId, run);
    } catch (err) {
      blocked = true;
      blockers = [{ code: 'approval_gate', message: err instanceof Error ? err.message : String(err) }];
    }

    return c.json({ runId, isWorkbenchRun: !!(run.correlationId || run.idempotencyKey), blocked, blockers });
  });
});
