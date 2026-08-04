// ─────────────────────────────────────────────────────────────────────────────
// Phase D — External Filing Handoff: gate rules.
//
// Pure, DB-free gate logic so every decision is unit-testable. Deterministic
// rules only — no AI influence. A run may only be marked filing-ready
// (handoff) or have an external filing recorded when every listed condition
// holds. Locked runs are immutable; the only way to change the package is a
// new run version (parent_run_id lineage), never a mutation of the locked run.
// ─────────────────────────────────────────────────────────────────────────────

export interface Blocker {
  code: string;
  message: string;
}

export interface HandoffGateContext {
  runLocked: boolean;
  evidencePresent: boolean;
  openReviewItemCount: number;
  pendingMappingProposalCount: number;
  ct600ValidationValid: boolean;
  /** null when the iXBRL artefact was not generated for this run. */
  ixbrlValidationValid: boolean | null;
  handoffAlreadyMarked: boolean;
}

export interface HandoffGateResult {
  blocked: boolean;
  blockers: Blocker[];
}

/**
 * Gates that must pass before a locked run may be marked filing-ready.
 * Mirrors the finalize/lock gates (open review items, pending mapping
 * decisions) and adds the export-validation requirement: the CT600 figures
 * and any included iXBRL document must validate clean.
 */
export function evaluateHandoffGates(ctx: HandoffGateContext): HandoffGateResult {
  const blockers: Blocker[] = [];

  if (!ctx.runLocked) {
    blockers.push({ code: 'run_not_locked', message: 'The run must be locked before it can be marked filing-ready.' });
  }

  if (!ctx.evidencePresent) {
    blockers.push({ code: 'evidence_required', message: 'Run has no linked source document; evidence is required before filing-ready handoff.' });
  }

  if (ctx.openReviewItemCount > 0) {
    blockers.push({
      code: 'open_review_items',
      message: `${ctx.openReviewItemCount} review item(s) are still open. Resolve them before filing-ready handoff.`,
    });
  }

  if (ctx.pendingMappingProposalCount > 0) {
    blockers.push({
      code: 'mapping_proposals_pending',
      message: `${ctx.pendingMappingProposalCount} mapping proposal(s) await decision. Resolve them before filing-ready handoff.`,
    });
  }

  if (!ctx.ct600ValidationValid) {
    blockers.push({
      code: 'ct600_validation_errors',
      message: 'The CT600 figures for this run have validation errors. Resolve them before filing-ready handoff.',
    });
  }

  if (ctx.ixbrlValidationValid === false) {
    blockers.push({
      code: 'ixbrl_validation_errors',
      message: 'The iXBRL document for this run has validation errors. Resolve them before filing-ready handoff.',
    });
  }

  if (ctx.handoffAlreadyMarked) {
    blockers.push({ code: 'already_handed_off', message: 'This run is already marked filing-ready.' });
  }

  return { blocked: blockers.length > 0, blockers };
}

export interface FilingGateContext {
  runLocked: boolean;
  handoffReady: boolean;
}

/**
 * Gates that must pass before an external filing event may be recorded.
 * Recording is bookkeeping of an event that happened OUTSIDE TaxPro — the
 * run must be locked and marked filing-ready. The manifest checksum is
 * validated by the route against the deterministic manifest for the run.
 */
export function evaluateFilingGate(ctx: FilingGateContext): HandoffGateResult {
  const blockers: Blocker[] = [];

  if (!ctx.runLocked) {
    blockers.push({ code: 'run_not_locked', message: 'The run must be locked to record an external filing.' });
  }

  if (!ctx.handoffReady) {
    blockers.push({
      code: 'handoff_not_ready',
      message: 'The run is not marked filing-ready. Complete the filing-ready handoff before recording an external filing.',
    });
  }

  return { blocked: blockers.length > 0, blockers };
}

/**
 * Maker-checker: when the tenant has maker-checker enabled, a run created
 * (or prepared) by user X may not be approved, locked, handed off or filed
 * by the same user X. Returns true when the actor is disqualified.
 */
export function violatesMakerChecker(
  makerCheckerEnabled: boolean,
  runCreatorUserId: string | null | undefined,
  actorUserId: string,
): boolean {
  if (!makerCheckerEnabled) return false;
  return !!runCreatorUserId && runCreatorUserId === actorUserId;
}

export function blockersToMessage(blockers: Blocker[]): string {
  return blockers.map((b) => b.message).join(' ');
}

export interface LifecycleSummary {
  status: string;
  approvalStatus: string;
  handoffReady: boolean;
  filedExternally: boolean;
  sourceDocumentLinked: boolean;
  openItemTypes: string[];
}

/**
 * Derived filing-handoff lifecycle stage for the UI. Honest only: every
 * stage is computed from stored state; 'filing_ready' and
 * 'filed_externally' are the two stages a TaxPro user can reach after lock.
 */
export function deriveLifecycleStage(s: LifecycleSummary): { stage: string; label: string } {
  if (s.filedExternally) return { stage: 'filed_externally', label: 'Filed externally (recorded)' };
  if (s.handoffReady) return { stage: 'filing_ready', label: 'Filing-ready handoff' };
  if (s.status === 'locked') return { stage: 'locked', label: 'Locked' };
  if (s.approvalStatus === 'approved') return { stage: 'approved', label: 'Approved' };
  if (s.status === 'calculated' && s.approvalStatus !== 'pending') return { stage: 'calculated', label: 'Calculated' };
  if (s.status === 'needs_review') {
    if (!s.sourceDocumentLinked) return { stage: 'needs_evidence', label: 'Needs evidence' };
    if (s.openItemTypes.includes('missing_mapping')) return { stage: 'needs_mapping_review', label: 'Needs mapping review' };
    return { stage: 'needs_tax_review', label: 'Needs tax review' };
  }
  return { stage: 'draft', label: 'Draft' };
}
