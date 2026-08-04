import { describe, it, expect } from 'vitest';
import { evaluateRunGates, evaluateApprovalGates } from '../modules/workbench/gates.js';

const fullContext = {
  entityPresent: true,
  entityJurisdictionKnown: true,
  evidencePresent: true,
  evidenceExtractionFailed: false,
  pendingMappingProposalCount: 0,
  nonStandardPeriodUnresolved: false,
  approvedRuleCount: 1,
};

describe('Phase C — run creation gates', () => {
  it('passes when entity, evidence, rules and decisions are all in place', () => {
    const result = evaluateRunGates(fullContext);
    expect(result.blocked).toBe(false);
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when no entity is selected', () => {
    const result = evaluateRunGates({ ...fullContext, entityPresent: false });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'entity_required')).toBe(true);
  });

  it('blocks when the entity jurisdiction is unrecognised (no guessing)', () => {
    const result = evaluateRunGates({ ...fullContext, entityJurisdictionKnown: false });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'jurisdiction_unknown')).toBe(true);
  });

  it('blocks when no source document evidence is linked', () => {
    const result = evaluateRunGates({ ...fullContext, evidencePresent: false });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'evidence_required')).toBe(true);
  });

  it('blocks when the linked document extraction failed', () => {
    const result = evaluateRunGates({ ...fullContext, evidenceExtractionFailed: true });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'evidence_extraction_failed')).toBe(true);
  });

  it('blocks while any mapping proposal is pending decision', () => {
    const result = evaluateRunGates({ ...fullContext, pendingMappingProposalCount: 2 });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'mapping_proposals_pending')).toBe(true);
  });

  it('blocks while a non-standard tax period review is unresolved', () => {
    const result = evaluateRunGates({ ...fullContext, nonStandardPeriodUnresolved: true });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'non_standard_period_requires_review')).toBe(true);
  });

  it('blocks when no approved rules are registered', () => {
    const result = evaluateRunGates({ ...fullContext, approvedRuleCount: 0 });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'no_approved_rules')).toBe(true);
  });

  it('reports every blocker at once (no short-circuit)', () => {
    const result = evaluateRunGates({
      ...fullContext,
      entityPresent: false,
      evidencePresent: false,
      pendingMappingProposalCount: 1,
      nonStandardPeriodUnresolved: true,
      approvedRuleCount: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockers.map((b) => b.code).sort()).toEqual([
      'entity_required',
      'evidence_required',
      'mapping_proposals_pending',
      'no_approved_rules',
      'non_standard_period_requires_review',
    ]);
  });
});

describe('Phase C — approval gates', () => {
  const ok = {
    isWorkbenchRun: true,
    evidencePresent: true,
    openCriticalReviewItemCount: 0,
    pendingMappingProposalCount: 0,
    nonStandardPeriodUnresolved: false,
  };

  it('passes when evidence, items, proposals and period are all clear', () => {
    const result = evaluateApprovalGates(ok);
    expect(result.blocked).toBe(false);
  });

  it('blocks finalize/lock on open critical review items', () => {
    const result = evaluateApprovalGates({ ...ok, openCriticalReviewItemCount: 1 });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'open_critical_review_items')).toBe(true);
  });

  it('blocks finalize/lock on missing evidence', () => {
    const result = evaluateApprovalGates({ ...ok, evidencePresent: false });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'evidence_required')).toBe(true);
  });

  it('blocks finalize/lock while mapping proposals are pending', () => {
    const result = evaluateApprovalGates({ ...ok, pendingMappingProposalCount: 3 });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'mapping_proposals_pending')).toBe(true);
  });

  it('blocks finalize/lock while the non-standard period review is open', () => {
    const result = evaluateApprovalGates({ ...ok, nonStandardPeriodUnresolved: true });
    expect(result.blocked).toBe(true);
    expect(result.blockers.some((b) => b.code === 'non_standard_period_requires_review')).toBe(true);
  });

  it('does not apply workbench gates to legacy runs', () => {
    const result = evaluateApprovalGates({ ...ok, isWorkbenchRun: false });
    expect(result.blocked).toBe(false);
    expect(result.blockers).toHaveLength(0);
  });
});
