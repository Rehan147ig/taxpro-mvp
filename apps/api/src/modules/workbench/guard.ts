// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Workbench guards (DB-backed application of the pure gate rules).
// Used by the workbench routes for fast pre-flight feedback and by the
// existing governance endpoints (finalize/lock) so approval remains blocked
// while evidence, critical review items, mapping decisions or non-standard
// period reviews are unresolved.
// ─────────────────────────────────────────────────────────────────────────────

import { and, count, eq } from 'drizzle-orm';
import { entities } from '../../db/schema/entities.js';
import { taxPeriods } from '../../db/schema/tax-periods.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { mappingProposals } from '../../db/schema/mapping-proposals.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { ukRules } from '../../db/schema/uk-rules.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { BadRequestError } from '../../lib/errors.js';
import { evaluateRunGates, evaluateApprovalGates, type RunGateContext, type Blocker } from './gates.js';

const UK_JURISDICTIONS = new Set(['UK_FRS102', 'UK_FRS102_S29', 'UK']);

export interface RunCreationGateResult {
  blocked: boolean;
  blockers: Blocker[];
  warnings: string[];
}

/**
 * Pre-flight check before a workbench calculation job is created.
 */
export async function evaluateRunCreationGates(
  tx: any,
  tenantId: string,
  payload: { entityId: string; taxPeriodId: string; sourceDocumentId: string },
): Promise<RunCreationGateResult> {
  const [entity] = await tx.select().from(entities)
    .where(and(eq(entities.tenantId, tenantId), eq(entities.id, payload.entityId))).limit(1);

  const [taxPeriod] = await tx.select().from(taxPeriods)
    .where(and(eq(taxPeriods.tenantId, tenantId), eq(taxPeriods.id, payload.taxPeriodId))).limit(1);

  // A non-standard tax period is unresolved while its review item is open.
  // Resolving that review (human + reason) is what clears the gate.
  const nonStandardPeriodUnresolved = !!taxPeriod && !taxPeriod.isStandardDuration
    && await hasOpenNonStandardPeriodItem(tx, tenantId, payload.entityId);

  const pendingProposalCount = await countRows(
    tx.select({ n: count() }).from(mappingProposals)
      .where(and(
        eq(mappingProposals.tenantId, tenantId),
        eq(mappingProposals.entityId, payload.entityId),
        eq(mappingProposals.status, 'pending'),
      )),
  );

  const approvedRuleCount = await countRows(
    tx.select({ n: count() }).from(ukRules)
      .where(and(eq(ukRules.tenantId, tenantId), eq(ukRules.approvalState, 'approved'))),
  );

  const ctx: RunGateContext = {
    entityPresent: !!entity,
    entityJurisdictionKnown: !!entity && UK_JURISDICTIONS.has((entity.taxJurisdiction ?? '').trim()),
    evidencePresent: !!payload.sourceDocumentId,
    evidenceExtractionFailed: false,
    pendingMappingProposalCount: pendingProposalCount,
    nonStandardPeriodUnresolved,
    approvedRuleCount: approvedRuleCount,
  };
  return evaluateRunGates(ctx);
}

/**
 * Approval/lock gate check for a specific run. Legacy runs (no workbench
 * contract) are not affected — they keep their existing, already strict
 * finalize/lock behaviour.
 */
export async function assertWorkbenchApprovalGates(
  tx: any,
  tenantId: string,
  run: typeof provisionRuns.$inferSelect,
): Promise<void> {
  const isWorkbenchRun = !!(run.correlationId || run.idempotencyKey);
  if (!isWorkbenchRun) return;

  const openCritical = await tx.select({ n: count() }).from(reviewItems)
    .where(and(
      eq(reviewItems.tenantId, tenantId),
      eq(reviewItems.provisionRunId, run.id),
      eq(reviewItems.status, 'open'),
      eq(reviewItems.severity, 'high'),
    ));

  const pendingProposalCount = run.entityId
    ? (await tx.select({ n: count() }).from(mappingProposals)
      .where(and(
        eq(mappingProposals.tenantId, tenantId),
        eq(mappingProposals.entityId, run.entityId),
        eq(mappingProposals.status, 'pending'),
      )))[0]?.n ?? 0
    : 0;

  let nonStandardPeriodUnresolved = false;
  if (run.taxPeriodId) {
    const [taxPeriod] = await tx.select().from(taxPeriods)
      .where(and(eq(taxPeriods.tenantId, tenantId), eq(taxPeriods.id, run.taxPeriodId))).limit(1);
    nonStandardPeriodUnresolved = !!taxPeriod && !taxPeriod.isStandardDuration
      && await hasOpenNonStandardPeriodItem(tx, tenantId, run.entityId ?? '');
  }

  const gateResult = evaluateApprovalGates({
    isWorkbenchRun: true,
    evidencePresent: !!run.sourceDocumentId,
    openCriticalReviewItemCount: openCritical[0]?.n ?? 0,
    pendingMappingProposalCount: pendingProposalCount,
    nonStandardPeriodUnresolved,
  });

  if (gateResult.blocked) {
    throw new BadRequestError(gateResult.blockers.map((b) => b.message).join(' '));
  }
}

async function countRows(query: Promise<{ n: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.n ?? 0;
}

async function hasOpenNonStandardPeriodItem(tx: any, tenantId: string, entityId: string): Promise<boolean> {
  if (!entityId) return false;
  const rows = await tx.select({ n: count() }).from(reviewItems)
    .where(and(
      eq(reviewItems.tenantId, tenantId),
      eq(reviewItems.entityId, entityId),
      eq(reviewItems.itemType, 'non_standard_period'),
      eq(reviewItems.status, 'open'),
    ));
  return (rows[0]?.n ?? 0) > 0;
}

export { hasOpenNonStandardPeriodItem };

export { UK_JURISDICTIONS };
