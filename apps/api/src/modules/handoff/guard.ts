// ─────────────────────────────────────────────────────────────────────────────
// Phase D — Handoff guards (DB-backed application of the pure gate rules).
// Loads the locked run, its result, entity and evidence, derives the CT600
// and iXBRL artefacts, validates them, and applies the pure gate logic.
// Also enforces maker-checker when the tenant has it configured.
// ─────────────────────────────────────────────────────────────────────────────

import { and, count, eq } from 'drizzle-orm';
import { BadRequestError, ForbiddenError } from '../../lib/errors.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { provisionResults } from '../../db/schema/provision-results.js';
import { entities } from '../../db/schema/entities.js';
import { sourceDocuments } from '../../db/schema/source-documents.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { mappingProposals } from '../../db/schema/mapping-proposals.js';
import { externalFilings } from '../../db/schema/external-filings.js';
import { tenants } from '../../db/schema/tenants.js';
import { validateCt600Return } from '../export/ct600-validation.js';
import { buildIxbrlInstance } from '../export/ixbrl.js';
import { buildHandoffCt600, bandSummary } from './ct600.js';
import { evaluateHandoffGates, evaluateFilingGate, violatesMakerChecker, type Blocker } from './gates.js';

export interface HandoffArtifacts {
  ct600: ReturnType<typeof buildHandoffCt600> | null;
  ct600Validation: { valid: boolean; rulesRun: number; violations: ReturnType<typeof validateCt600Return>['violations']; skipped: ReturnType<typeof validateCt600Return>['skipped'] } | null;
  ixbrl: { filename: string; content: string; validation: { valid: boolean; checksRun: number; violations: string[] } } | null;
}

export interface HandoffGateEval {
  blocked: boolean;
  blockers: Blocker[];
  artifacts: HandoffArtifacts;
}

/**
 * Load everything needed for handoff decisions and derive + validate the
 * filing artefacts for the run. Returns the gate verdict and the derived
 * artefacts (so routes build the package/manifest exactly once).
 */
export async function evaluateHandoffGatesDb(tx: any, tenantId: string, runId: string): Promise<HandoffGateEval> {
  const [run] = await tx.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

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

  const [document] = run.sourceDocumentId
    ? await tx.select({ id: sourceDocuments.id, filename: sourceDocuments.filename, sha256: sourceDocuments.sha256, version: sourceDocuments.version })
      .from(sourceDocuments).where(and(eq(sourceDocuments.tenantId, tenantId), eq(sourceDocuments.id, run.sourceDocumentId))).limit(1)
    : [];

  const openItems = await tx.select({ n: count() }).from(reviewItems)
    .where(and(eq(reviewItems.tenantId, tenantId), eq(reviewItems.provisionRunId, runId), eq(reviewItems.status, 'open')));

  const pendingProposals = run.entityId
    ? await tx.select({ n: count() }).from(mappingProposals)
      .where(and(eq(mappingProposals.tenantId, tenantId), eq(mappingProposals.entityId, run.entityId), eq(mappingProposals.status, 'pending')))
    : [{ n: 0 }];

  const artifacts = deriveHandoffArtifacts(run, result, entity);

  const gateResult = evaluateHandoffGates({
    runLocked: run.status === 'locked',
    evidencePresent: !!run.sourceDocumentId,
    openReviewItemCount: openItems[0]?.n ?? 0,
    pendingMappingProposalCount: pendingProposals[0]?.n ?? 0,
    ct600ValidationValid: artifacts.ct600Validation ? artifacts.ct600Validation.valid : true,
    ixbrlValidationValid: artifacts.ixbrl ? artifacts.ixbrl.validation.valid : null,
    handoffAlreadyMarked: !!run.handoffReadyAt,
  });

  return { blocked: gateResult.blocked, blockers: gateResult.blockers, artifacts };
}

/**
 * Pure derivation of the CT600 + iXBRL artefacts from stored run data.
 * Deterministic: no wall-clock time (generatedAt from lockedAt/approvedAt).
 */
export function deriveHandoffArtifacts(
  run: typeof provisionRuns.$inferSelect,
  result: typeof provisionResults.$inferSelect | undefined,
  entity: { id: string; name: string; externalId: string | null } | null,
): HandoffArtifacts {
  const periodStart = run.period;
  const periodEnd = String(run.endPeriod ?? run.period);
  const externalId = entity?.externalId ?? '';
  const utr = externalId.match(/^\d{10}$/)?.[0] ?? '0000000000';
  // Only surface a Companies House number when the external id actually looks
  // like one (2 letters + 6 digits, or 8 digits) — a UTR must never be
  // reported as a CH number (CT600 COMPANY_NUMBER_FORMAT).
  const companiesHouseNumber = /^(?:[A-Za-z]{2}\d{6}|\d{8})$/.test(externalId) ? externalId : undefined;
  const company = {
    companyName: entity?.name ?? 'Unknown company',
    utr,
    ...(companiesHouseNumber ? { companiesHouseNumber } : {}),
  };
  const detail = (result?.detail ?? null) as { currentTax?: Record<string, unknown> } | null;
  const generatedAt = run.lockedAt?.toISOString() ?? run.approvedAt?.toISOString() ?? run.createdAt?.toISOString() ?? '';

  const ct600 = buildHandoffCt600(company, { start: periodStart, end: periodEnd }, { currentTax: detail?.currentTax ?? {} }, generatedAt);
  const ct600Validation = validateCt600Return(ct600);

  let ixbrl: HandoffArtifacts['ixbrl'] = null;
  const ct = (detail?.currentTax ?? {}) as Record<string, any>;
  if (entity && result) {
    const doc = buildIxbrlInstance({
      companyName: entity.name,
      companiesHouseNumber: entity.externalId ?? '00000000',
      periodStart,
      periodEnd,
      currency: 'GBP',
      figures: {
        revenue: 0,
        profitBeforeTax: Number(ct.bookIncome ?? result.bookIncome ?? 0),
        taxOnProfitOrLoss: Number(result.totalTaxExpense ?? 0),
        currentTax: Number(ct.federalTax ?? result.currentTaxExpense ?? 0),
        deferredTax: Number(ct.deferredTaxExpense ?? result.deferredTaxExpense ?? 0),
        profitAfterTax: Math.max(0, Number(result.bookIncome ?? 0) - Number(result.totalTaxExpense ?? 0)),
      },
    });
    ixbrl = {
      filename: `ixbrl-${periodStart}.xml`,
      content: doc.content,
      validation: { valid: doc.validation.valid, checksRun: doc.validation.checksRun, violations: doc.validation.violations },
    };
  }

  return { ct600, ct600Validation, ixbrl };
}

/**
 * Maker-checker enforcement: when the tenant has maker-checker enabled, the
 * actor must not be the user who created/prepared the run.
 */
export async function assertMakerChecker(tx: any, tenantId: string, run: typeof provisionRuns.$inferSelect, actorUserId: string): Promise<void> {
  const [tenant] = await tx.select({ makerCheckerEnabled: tenants.makerCheckerEnabled }).from(tenants)
    .where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new BadRequestError('Tenant not found');
  if (violatesMakerChecker(tenant.makerCheckerEnabled, run.requestedByUserId ?? run.preparedByUserId, actorUserId)) {
    throw new ForbiddenError('Maker-checker is enabled for this tenant: the user who created or prepared the run cannot also approve, lock, hand off or record its filing.');
  }
}

export async function assertFilingRecordable(
  tx: any,
  tenantId: string,
  runId: string,
  manifestChecksum: string,
  actorUserId: string,
): Promise<{ run: typeof provisionRuns.$inferSelect }> {
  const [run] = await tx.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, tenantId))).limit(1).for('update');
  if (!run) throw new BadRequestError('Provision run not found');

  const gateResult = evaluateFilingGate({
    runLocked: run.status === 'locked',
    handoffReady: !!run.handoffReadyAt,
  });
  if (gateResult.blocked) {
    throw new BadRequestError(gateResult.blockers.map((b) => b.message).join(' '));
  }

  await assertMakerChecker(tx, tenantId, run, actorUserId);

  return { run };
}

export async function listExternalFilings(tx: any, tenantId: string, runId: string): Promise<typeof externalFilings.$inferSelect[]> {
  return tx.select().from(externalFilings)
    .where(and(eq(externalFilings.tenantId, tenantId), eq(externalFilings.runId, runId)))
    .orderBy(externalFilings.createdAt);
}
