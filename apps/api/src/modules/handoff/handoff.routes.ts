// ─────────────────────────────────────────────────────────────────────────────
// Phase D — External Filing Handoff API.
//
// The controlled-evidence surface of the UK filing workflow:
//   GET  /runs/:id           — handoff view (lifecycle, gates, filings)
//   POST /runs/:id/handoff-ready   — mark filing-ready (authorised roles only)
//   POST /runs/:id/record-filing   — record an EXTERNAL filing event
//   GET  /runs/:id/manifest  — deterministic evidence manifest (+ sha256)
//   GET  /runs/:id/package   — deterministic export package (ZIP)
//
// HONESTY CONTRACT: TaxPro never submits to HMRC. handoff-ready is a
// bookkeeping state; record-filing records an event that happened OUTSIDE
// TaxPro. No endpoint here claims a submission happened.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { requireRole, requireRunAccess } from '../../lib/middleware/rbac.js';
import { BadRequestError } from '../../lib/errors.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { provisionResults } from '../../db/schema/provision-results.js';
import { entities } from '../../db/schema/entities.js';
import { sourceDocuments } from '../../db/schema/source-documents.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { externalFilings } from '../../db/schema/external-filings.js';
import { recordProvisionEvent, getEventsForRun, EVENT_TYPES } from '../provision/provision-events.js';
import { auditSensitiveOp } from '../provision/audit.js';
import { buildHandoffPackage, type HandoffPackageInput } from './package.js';
import { deriveLifecycleStage } from './gates.js';
import { evaluateHandoffGatesDb, assertMakerChecker, assertFilingRecordable, listExternalFilings, deriveHandoffArtifacts } from './guard.js';
import { bandSummary, type HandoffCt600Detail } from './ct600.js';

export const handoffRoutes = new Hono();
handoffRoutes.use('*', authMiddleware);

const recordFilingSchema = z.object({
  filingProvider: z.string().min(2).max(80),
  filingReference: z.string().min(1).max(120),
  submittedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'submittedDate must be YYYY-MM-DD'),
  confirmationDocumentId: z.string().uuid().optional(),
  supersedesFilingId: z.string().uuid().optional(),
  manifestChecksum: z.string().regex(/^[0-9a-f]{64}$/, 'manifestChecksum must be a 64-char SHA-256 hex digest'),
});

// ── Handoff view ─────────────────────────────────────────────────────────────

handoffRoutes.get('/runs/:id', async (c) => {
  const user = c.get('user');
  const runId = c.req.param('id');

  return withTenantContext(user.tenantId, async (tx) => {
    await requireRunAccess(runId, user.tenantId, tx);

    const [run] = await tx.select().from(provisionRuns)
      .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
    if (!run) throw new BadRequestError('Provision run not found');

    const gateEval = await evaluateHandoffGatesDb(tx, user.tenantId, runId);
    const filings = await listExternalFilings(tx, user.tenantId, runId);
    const events = await getEventsForRun(runId, user.tenantId, tx);

    const items = await tx.select().from(reviewItems)
      .where(and(eq(reviewItems.tenantId, user.tenantId), eq(reviewItems.provisionRunId, runId)))
      .orderBy(reviewItems.createdAt);

    const lifecycle = deriveLifecycleStage({
      status: run.status,
      approvalStatus: run.approvalStatus,
      handoffReady: !!run.handoffReadyAt,
      filedExternally: !!run.filedExternallyAt,
      sourceDocumentLinked: !!run.sourceDocumentId,
      openItemTypes: items.filter((i) => i.status === 'open').map((i) => i.itemType),
    });

    return c.json({
      runId,
      lifecycle,
      run: {
        id: run.id,
        period: run.period,
        endPeriod: run.endPeriod,
        entityId: run.entityId,
        status: run.status,
        approvalStatus: run.approvalStatus,
        submittedAt: run.submittedAt,
        submittedByUserId: run.submittedByUserId,
        approvedAt: run.approvedAt,
        approvedByUserId: run.approvedByUserId,
        lockedAt: run.lockedAt,
        lockedByUserId: run.lockedByUserId,
        handoffReadyAt: run.handoffReadyAt,
        handoffReadyByUserId: run.handoffReadyByUserId,
        filedExternallyAt: run.filedExternallyAt,
        filedExternallyByUserId: run.filedExternallyByUserId,
        sourceDocumentId: run.sourceDocumentId,
      },
      blockers: gateEval.blocked ? gateEval.blockers : [],
      validation: {
        ct600: gateEval.artifacts.ct600Validation,
        ixbrl: gateEval.artifacts.ixbrl
          ? { included: gateEval.artifacts.ixbrl.validation.valid, valid: gateEval.artifacts.ixbrl.validation.valid, checksRun: gateEval.artifacts.ixbrl.validation.checksRun, violations: gateEval.artifacts.ixbrl.validation.violations }
          : null,
      },
      externalFilings: filings.map((f) => ({
        id: f.id,
        filingProvider: f.filingProvider,
        filingReference: f.filingReference,
        submittedDate: f.submittedDate,
        recordedByUserId: f.recordedByUserId,
        confirmationDocumentId: f.confirmationDocumentId,
        confirmationDocumentHash: f.confirmationDocumentHash,
        manifestChecksum: f.manifestChecksum,
        supersedesFilingId: f.supersedesFilingId,
        createdAt: f.createdAt,
      })),
      reviewItems: items.map((i) => ({
        id: i.id,
        itemType: i.itemType,
        title: i.title,
        severity: i.severity,
        status: i.status,
        resolutionNote: i.resolutionNote,
        resolvedAt: i.resolvedAt,
        resolvedByUserId: i.resolvedByUserId,
      })),
      approvalEvents: events.map((e) => ({
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        actorUserId: e.actorUserId,
        actorType: e.actorType,
        reason: e.reason,
        metadata: e.metadata as Record<string, unknown> | null,
      })),
      honesty: {
        note: 'TaxPro does not submit to HMRC. Filing-ready handoff and external filing records are bookkeeping of events that happen outside TaxPro.',
        notFiledByTaxPro: run.filedExternallyAt === null,
      },
    });
  });
});

// ── Mark filing-ready (handoff) ──────────────────────────────────────────────

handoffRoutes.post('/runs/:id/handoff-ready',
  requireRole('partner', 'admin'),
  async (c) => {
    const user = c.get('user');
    const { id: runId } = c.req.param();

    return withTenantContext(user.tenantId, async (tx) => {
      await requireRunAccess(runId, user.tenantId, tx);
      const [run] = await tx.select().from(provisionRuns)
        .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1).for('update');
      if (!run) throw new BadRequestError('Provision run not found');

      await assertMakerChecker(tx, user.tenantId, run, user.userId);

      const gateEval = await evaluateHandoffGatesDb(tx, user.tenantId, runId);
      if (gateEval.blocked) {
        return c.json({ blocked: true, blockers: gateEval.blockers }, 400);
      }

      const now = new Date();
      await tx.update(provisionRuns).set({
        handoffReadyAt: now,
        handoffReadyByUserId: user.userId,
        updatedAt: now,
      }).where(eq(provisionRuns.id, runId));

      await auditSensitiveOp(tx, {
        tenantId: user.tenantId,
        runId,
        action: 'run.handoff_ready',
        actorUserId: user.userId,
        actorRole: user.role,
        details: { period: run.period, previousStatus: run.status },
        requestId: c.get('requestId'),
      });

      return c.json({ runId, handoffReadyAt: now.toISOString(), handoffReadyByUserId: user.userId });
    });
  });

// ── Record an EXTERNAL filing event ─────────────────────────────────────────

handoffRoutes.post('/runs/:id/record-filing',
  requireRole('partner', 'admin'),
  zValidator('json', recordFilingSchema),
  async (c) => {
    const user = c.get('user');
    const { id: runId } = c.req.param();
    const body = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      await requireRunAccess(runId, user.tenantId, tx);
      const { run } = await assertFilingRecordable(tx, user.tenantId, runId, body.manifestChecksum, user.userId);

      let confirmationDocHash: string | null = null;
      if (body.confirmationDocumentId) {
        const [doc] = await tx.select({ id: sourceDocuments.id, sha256: sourceDocuments.sha256 })
          .from(sourceDocuments)
          .where(and(eq(sourceDocuments.tenantId, user.tenantId), eq(sourceDocuments.id, body.confirmationDocumentId))).limit(1);
        if (!doc) throw new BadRequestError('Confirmation document not found in this tenant');
        confirmationDocHash = doc.sha256;
      }

      if (body.supersedesFilingId) {
        const [prior] = await tx.select({ id: externalFilings.id }).from(externalFilings)
          .where(and(
            eq(externalFilings.tenantId, user.tenantId),
            eq(externalFilings.id, body.supersedesFilingId),
            eq(externalFilings.runId, runId),
          )).limit(1);
        if (!prior) throw new BadRequestError('supersedesFilingId does not reference a filing of this run in this tenant');
      }

      // The recorded manifest checksum MUST match the deterministic manifest
      // for this (immutable, locked) run — re-verified against the actual
      // exported content every time a filing is recorded.
      const packageResult = await buildHandoffPackage(await loadPackageInput(tx, user.tenantId, run, body.confirmationDocumentId ?? null));
      if (packageResult.manifestSha256 !== body.manifestChecksum) {
        throw new BadRequestError('manifestChecksum does not match the deterministic manifest for this run. Re-export the package and use its manifest SHA-256.');
      }

      const [filing] = await tx.insert(externalFilings).values({
        tenantId: user.tenantId,
        runId,
        filingProvider: body.filingProvider,
        filingReference: body.filingReference,
        submittedDate: body.submittedDate,
        recordedByUserId: user.userId,
        confirmationDocumentId: body.confirmationDocumentId ?? null,
        confirmationDocumentHash: confirmationDocHash,
        manifestChecksum: body.manifestChecksum,
        supersedesFilingId: body.supersedesFilingId ?? null,
      }).returning();

      const now = new Date();
      await tx.update(provisionRuns).set({
        filedExternallyAt: now,
        filedExternallyByUserId: user.userId,
        updatedAt: now,
      }).where(eq(provisionRuns.id, runId));

      await auditSensitiveOp(tx, {
        tenantId: user.tenantId,
        runId,
        action: 'run.filed_externally',
        actorUserId: user.userId,
        actorRole: user.role,
        details: {
          filingId: filing.id,
          filingProvider: body.filingProvider,
          filingReference: body.filingReference,
          submittedDate: body.submittedDate,
          manifestChecksum: body.manifestChecksum,
          supersedesFilingId: body.supersedesFilingId ?? null,
        },
        requestId: c.get('requestId'),
      });

      return c.json({
        runId,
        filing: {
          id: filing.id,
          filingProvider: filing.filingProvider,
          filingReference: filing.filingReference,
          submittedDate: filing.submittedDate,
          recordedByUserId: filing.recordedByUserId,
          manifestChecksum: filing.manifestChecksum,
          supersedesFilingId: filing.supersedesFilingId,
        },
        filedExternallyAt: now.toISOString(),
        note: 'Recorded as an external filing event. TaxPro did not submit this return.',
      });
    });
  });

// ── Deterministic manifest ──────────────────────────────────────────────────

handoffRoutes.get('/runs/:id/manifest', async (c) => {
  const user = c.get('user');
  const { id: runId } = c.req.param();

  return withTenantContext(user.tenantId, async (tx) => {
    await requireRunAccess(runId, user.tenantId, tx);
    const [run] = await tx.select().from(provisionRuns)
      .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
    if (!run) throw new BadRequestError('Provision run not found');
    if (run.status !== 'locked' && run.status !== 'finalized') {
      throw new BadRequestError('The evidence manifest is only available for locked runs.');
    }

    const packageResult = await buildHandoffPackage(await loadPackageInput(tx, user.tenantId, run, null));

    await recordProvisionEvent({
      tenantId: user.tenantId,
      provisionRunId: runId,
      eventType: EVENT_TYPES.EXPORT_HANDOFF_PACKAGE,
      actorType: 'user',
      actorUserId: user.userId,
      reason: 'Filing-handoff manifest viewed',
      metadata: { manifestSha256: packageResult.manifestSha256 },
    }, tx);

    c.header('x-manifest-sha256', packageResult.manifestSha256);
    return c.json({ sha256: packageResult.manifestSha256, manifest: packageResult.manifest });
  });
});

// ── Deterministic package download ──────────────────────────────────────────

handoffRoutes.get('/runs/:id/package',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  async (c) => {
    const user = c.get('user');
    const { id: runId } = c.req.param();

    return withTenantContext(user.tenantId, async (tx) => {
      await requireRunAccess(runId, user.tenantId, tx);
      const [run] = await tx.select().from(provisionRuns)
        .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
      if (!run) throw new BadRequestError('Provision run not found');
      if (run.status !== 'locked' && run.status !== 'finalized') {
        throw new BadRequestError('The filing package is only available for locked runs.');
      }

      const packageResult = await buildHandoffPackage(await loadPackageInput(tx, user.tenantId, run, null));

      await recordProvisionEvent({
        tenantId: user.tenantId,
        provisionRunId: runId,
        eventType: EVENT_TYPES.EXPORT_HANDOFF_PACKAGE,
        actorType: 'user',
        actorUserId: user.userId,
        reason: 'Filing-handoff package exported',
        metadata: { manifestSha256: packageResult.manifestSha256, fileCount: packageResult.files.length },
      }, tx);

      c.header('Content-Type', 'application/zip');
      c.header('Content-Disposition', `attachment; filename="taxpro-uk-filing-package-${run.period}.zip"`);
      c.header('x-manifest-sha256', packageResult.manifestSha256);
      return c.body(packageResult.zip as any);
    });
  });

// ── Shared package input assembly ───────────────────────────────────────────

async function loadPackageInput(
  tx: any,
  tenantId: string,
  run: typeof provisionRuns.$inferSelect,
  confirmationDocumentId: string | null,
): Promise<HandoffPackageInput> {
  const [result] = run.resultId
    ? await tx.select().from(provisionResults)
      .where(and(eq(provisionResults.id, run.resultId), eq(provisionResults.tenantId, tenantId))).limit(1)
    : [];

  const [entity] = run.entityId
    ? await tx.select({
      id: entities.id, name: entities.name, externalId: entities.externalId,
      taxJurisdiction: entities.taxJurisdiction, currency: entities.currency,
    }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.id, run.entityId))).limit(1)
    : [];

  const evidenceDocs: Array<{ id: string; filename: string; documentType: string; sha256: string; version: number }> = await tx.select({
    id: sourceDocuments.id, filename: sourceDocuments.filename, documentType: sourceDocuments.documentType,
    sha256: sourceDocuments.sha256, version: sourceDocuments.version,
  }).from(sourceDocuments)
    .where(and(eq(sourceDocuments.tenantId, tenantId), eq(sourceDocuments.isCurrent, true)))
    .orderBy(sourceDocuments.createdAt);

  const events = await getEventsForRun(run.id, tenantId, tx);
  // Determinism: viewer events (package/manifest downloads) and post-lock
  // state events (handoff-ready, external-filing records) are excluded from
  // the package's own audit trail. They would grow the trail and change the
  // manifest hash, breaking the contract that any recorded filing checksum is
  // re-verifiable against a fresh export of the locked run. Those states are
  // still pinned inside the package via approvals.handoffReadyAt /
  // filedExternallyAt, and external filing records live in the external_filings
  // table (surfaced by the handoff view), not in the immutable package.
  const AUDIT_EXCLUDED = new Set<string>([EVENT_TYPES.EXPORT_HANDOFF_PACKAGE, EVENT_TYPES.HANDOFF_READY, EVENT_TYPES.FILED_EXTERNALLY]);
  const auditEntries = events
    .filter((e) => !AUDIT_EXCLUDED.has(e.eventType))
    .map((e) => ({
    timestamp: e.occurredAt ? new Date(e.occurredAt).toISOString() : '',
    eventType: e.eventType,
    actor: e.actorType === 'user' ? (e.actorUserId ?? 'user') : e.actorType,
    description: e.reason ?? e.eventType,
    metadata: e.metadata as Record<string, unknown> | undefined,
  }));

  const items: typeof reviewItems.$inferSelect[] = await tx.select().from(reviewItems)
    .where(and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.provisionRunId, run.id)))
    .orderBy(reviewItems.createdAt);

  const reviewDecisions = items.map((i) => ({
    id: i.id,
    itemType: i.itemType,
    title: i.title,
    severity: i.severity,
    status: i.status,
    resolutionNote: i.resolutionNote,
    resolvedAt: i.resolvedAt ? new Date(i.resolvedAt).toISOString() : null,
    resolvedByUserId: i.resolvedByUserId,
  }));

  const approvals = {
    approvalStatus: run.approvalStatus,
    submittedAt: run.submittedAt ? new Date(run.submittedAt).toISOString() : null,
    submittedByUserId: run.submittedByUserId,
    approvedAt: run.approvedAt ? new Date(run.approvedAt).toISOString() : null,
    approvedByUserId: run.approvedByUserId,
    lockedAt: run.lockedAt ? new Date(run.lockedAt).toISOString() : null,
    lockedByUserId: run.lockedByUserId,
    handoffReadyAt: run.handoffReadyAt ? new Date(run.handoffReadyAt).toISOString() : null,
    handoffReadyByUserId: run.handoffReadyByUserId,
    // The manifest must stay byte-identical for the locked run regardless of
    // later external-filing records: the evidence chain is
    //   filing record (manifestChecksum) → manifest → package contents.
    // Recording a filing must never invalidate a previously recorded checksum,
    // so filedExternallyAt/by are pinned as null here; the live state is
    // available on the run row and in the external_filings table.
    filedExternallyAt: null,
    filedExternallyByUserId: null,
  };

  const artifacts = deriveHandoffArtifacts(run, result, entity);

  const periodEnd = String(run.endPeriod ?? run.period);
  const ct600Band = bandSummary(((result?.detail ?? null) as HandoffCt600Detail | null) ?? {});

  // Evidence index: the linked source document plus the optional
  // confirmation document — hashes only, never contents.
  const evidenceIndex = [
    ...(evidenceDocs.filter((d) => d.id === run.sourceDocumentId)),
    ...(confirmationDocumentId ? evidenceDocs.filter((d) => d.id === confirmationDocumentId) : []),
  ];

  return {
    period: run.period,
    bookIncome: Number(result?.bookIncome ?? 0),
    currentTaxExpense: Number(result?.currentTaxExpense ?? 0),
    deferredTaxExpense: Number(result?.deferredTaxExpense ?? 0),
    totalTaxExpense: Number(result?.totalTaxExpense ?? 0),
    effectiveTaxRate: Number(result?.effectiveTaxRate ?? 0),
    statutoryRate: Number(result?.statutoryRate ?? 0),
    taxPayable: Number(result?.taxPayable ?? 0),
    createdAt: result?.createdAt ? new Date(result.createdAt).toISOString() : (run.createdAt ? new Date(run.createdAt).toISOString() : ''),
    auditEntries,
    detail: (result?.detail ?? null) as Record<string, unknown> | null,
    ct600: artifacts.ct600,
    ct600Validation: artifacts.ct600Validation
      ? { ct600: artifacts.ct600Validation, ixbrl: null }
      : { ct600: { valid: true, rulesRun: 0, violations: [], skipped: [] }, ixbrl: null },
    ixbrl: artifacts.ixbrl,
    evidenceIndex: evidenceIndex.map((d) => ({ id: d.id, filename: d.filename, documentType: d.documentType, sha256: d.sha256, version: d.version })),
    assumptions: run.assumptions,
    reviewDecisions,
    approvals,
    manifestInput: {
      tenantId,
      entity,
      periodStart: run.period,
      periodEnd,
      ct600Band,
      run: {
        id: run.id,
        engineVersion: run.engineVersion,
        rulesUsed: (run.rulesUsed ?? null) as Record<string, unknown> | null,
        inputDataHash: run.inputDataHash,
        mappingVersionHash: run.mappingVersionHash,
        parentRunId: run.parentRunId,
        correlationId: run.correlationId,
        idempotencyKey: run.idempotencyKey,
        status: run.status,
        approvalStatus: run.approvalStatus,
        sourceDocumentId: run.sourceDocumentId,
      },
      evidence: evidenceDocs.find((d) => d.id === run.sourceDocumentId) ?? null,
      assumptions: run.assumptions,
      warnings: run.warnings,
      approvals,
      reviewDecisions,
      validation: artifacts.ct600Validation
        ? {
          ct600: {
            valid: artifacts.ct600Validation.valid,
            rulesRun: artifacts.ct600Validation.rulesRun,
            violations: artifacts.ct600Validation.violations,
            skipped: artifacts.ct600Validation.skipped,
          },
          ixbrl: artifacts.ixbrl
            ? { included: artifacts.ixbrl.validation.valid, valid: artifacts.ixbrl.validation.valid, checksRun: artifacts.ixbrl.validation.checksRun, violations: artifacts.ixbrl.validation.violations }
            : null,
        }
        : { ct600: { valid: true, rulesRun: 0, violations: [], skipped: [] }, ixbrl: null },
      ct600: artifacts.ct600,
    },
  };
}
