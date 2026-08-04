// ─────────────────────────────────────────────────────────────────────────────
// Phase C — UK Tax-Close Workbench: approval gates.
//
// Pure, DB-free gate logic so every decision is unit-testable and shared by
// the workbench routes, the job executor and the existing governance
// endpoints (finalize/lock). Deterministic rules only — no AI influence.
// ─────────────────────────────────────────────────────────────────────────────

export interface Blocker {
  code: string;
  message: string;
}

export interface RunGateContext {
  entityPresent: boolean;
  entityJurisdictionKnown: boolean;
  evidencePresent: boolean;
  evidenceExtractionFailed: boolean;
  pendingMappingProposalCount: number;
  nonStandardPeriodUnresolved: boolean;
  approvedRuleCount: number;
}

export interface RunGateResult {
  blocked: boolean;
  blockers: Blocker[];
  warnings: string[];
}

/**
 * Gates that must pass before a workbench calculation run can be created.
 * Pending mapping proposals block calculation (decisions are queued, so the
 * mapping snapshot would be incomplete); non-standard tax periods must be
 * reviewed first; evidence (an imported source document) is mandatory.
 */
export function evaluateRunGates(ctx: RunGateContext): RunGateResult {
  const blockers: Blocker[] = [];
  const warnings: string[] = [];

  if (!ctx.entityPresent) {
    blockers.push({ code: 'entity_required', message: 'Select an entity before running a calculation.' });
  } else if (!ctx.entityJurisdictionKnown) {
    blockers.push({
      code: 'jurisdiction_unknown',
      message: 'Entity has no recognised tax jurisdiction — refusing to compute under a guessed regime.',
    });
  }

  if (!ctx.evidencePresent) {
    blockers.push({ code: 'evidence_required', message: 'No source document linked to this calculation. Import a trial balance from a source document first.' });
  } else if (ctx.evidenceExtractionFailed) {
    blockers.push({ code: 'evidence_extraction_failed', message: 'The linked source document has a failed extraction status; re-upload or re-import before calculating.' });
  }

  if (ctx.pendingMappingProposalCount > 0) {
    blockers.push({
      code: 'mapping_proposals_pending',
      message: `${ctx.pendingMappingProposalCount} mapping proposal(s) are awaiting decision. Approve or reject them before calculating so the mapping snapshot is complete.`,
    });
  }

  if (ctx.nonStandardPeriodUnresolved) {
    blockers.push({
      code: 'non_standard_period_requires_review',
      message: 'This tax period is non-standard in duration and its review item is still open. Resolve the review before calculating.',
    });
  }

  if (ctx.approvedRuleCount === 0) {
    blockers.push({ code: 'no_approved_rules', message: 'No approved UK rules are registered for this tenant. Calculations require approved rule versions.' });
  }

  return { blocked: blockers.length > 0, blockers, warnings };
}

export interface ApprovalGateContext {
  isWorkbenchRun: boolean;
  evidencePresent: boolean;
  openCriticalReviewItemCount: number;
  pendingMappingProposalCount: number;
  nonStandardPeriodUnresolved: boolean;
}

export interface ApprovalGateResult {
  blocked: boolean;
  blockers: Blocker[];
}

/**
 * Gates that must pass before a run may be finalized or locked.
 * Applied to workbench-created runs; legacy runs keep their existing
 * (already strict) finalize/lock behaviour — open review items still block.
 */
export function evaluateApprovalGates(ctx: ApprovalGateContext): ApprovalGateResult {
  const blockers: Blocker[] = [];

  if (!ctx.isWorkbenchRun) {
    return { blocked: false, blockers };
  }

  if (!ctx.evidencePresent) {
    blockers.push({ code: 'evidence_required', message: 'Run has no linked source document; evidence is required before approval.' });
  }

  if (ctx.openCriticalReviewItemCount > 0) {
    blockers.push({
      code: 'open_critical_review_items',
      message: `${ctx.openCriticalReviewItemCount} critical review item(s) are still open. Resolve them before approving or locking.`,
    });
  }

  if (ctx.pendingMappingProposalCount > 0) {
    blockers.push({
      code: 'mapping_proposals_pending',
      message: `${ctx.pendingMappingProposalCount} mapping proposal(s) await decision. Resolve them before approving or locking.`,
    });
  }

  if (ctx.nonStandardPeriodUnresolved) {
    blockers.push({
      code: 'non_standard_period_requires_review',
      message: 'The tax period is non-standard and its review is still open. Resolve it before approving or locking.',
    });
  }

  return { blocked: blockers.length > 0, blockers };
}

export function blockersToMessage(blockers: Blocker[]): string {
  return blockers.map((b) => b.message).join(' ');
}
