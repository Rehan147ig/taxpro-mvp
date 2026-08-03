// Tests for the rule-update proposal contract (deterministic, no LLM).

import { describe, expect, it } from 'vitest';
import { STATE_RULESET } from '../us/state-rules.js';
import {
  diffProposalAgainstRuleset,
  validateProposal,
  type RulesetProposal,
} from '../us/proposals.js';

const base: RulesetProposal = {
  stateCode: 'NE',
  taxYear: 2027,
  filingType: 'cit',
  schedule: { kind: 'flat', rate: 0.0399 },
  apportionmentWeights: { payroll: 0, property: 0, sales: 1 },
  source: {
    name: 'Nebraska Revenue',
    url: 'https://revenue.nebraska.gov/legal-administrative-regulations',
    publishedAt: '2026-06-01',
  },
  excerpt:
    'Neb. Rev. Stat. §77-2734.04: the corporate income tax rate shall be 3.99% for tax years beginning on or after January 1, 2027.',
  confidence: 0.95,
  reasoning: 'Statute text sets the rate at 3.99% effective 2027, subject to revenue trigger.',
};

describe('validateProposal', () => {
  it('accepts a well-formed proposal', () => {
    const v = validateProposal(base);
    expect(v.valid).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it('rejects an unknown state code', () => {
    const v = validateProposal({ ...base, stateCode: 'XX' });
    expect(v.valid).toBe(false);
    expect(v.issues.some(i => /stateCode/.test(i))).toBe(true);
  });

  it('rejects a rate outside the sane range', () => {
    const v = validateProposal({ ...base, schedule: { kind: 'flat', rate: 0.5 } });
    expect(v.valid).toBe(false);
    expect(v.issues.some(i => /schedule\.rate/.test(i))).toBe(true);
  });

  it('rejects weights that do not sum to 1', () => {
    const v = validateProposal({
      ...base,
      apportionmentWeights: { payroll: 0.5, property: 0.5, sales: 0.5 },
    });
    expect(v.valid).toBe(false);
    expect(v.issues.some(i => /apportionmentWeights sum/.test(i))).toBe(true);
  });

  it('rejects a proposal without provenance', () => {
    const v = validateProposal({ ...base, source: { ...base.source, url: '' } });
    expect(v.valid).toBe(false);
    expect(v.issues.some(i => /source/.test(i))).toBe(true);
  });

  it('rejects a proposal without the raw excerpt', () => {
    const v = validateProposal({ ...base, excerpt: '  ' });
    expect(v.valid).toBe(false);
    expect(v.issues.some(i => /excerpt/.test(i))).toBe(true);
  });

  it('rejects an out-of-range confidence', () => {
    const v = validateProposal({ ...base, confidence: 1.5 });
    expect(v.valid).toBe(false);
  });
});

describe('diffProposalAgainstRuleset', () => {
  it('returns an empty change list for a no-op proposal', () => {
    const current = STATE_RULESET.find(r => r.stateCode === 'CA')!;
    const d = diffProposalAgainstRuleset({
      ...base,
      stateCode: 'CA',
      taxYear: 2026,
      schedule: { kind: current.schedule.kind, rate: current.schedule.rate },
      apportionmentWeights: current.apportionmentWeights,
    });
    expect(d.breaking).toBe(false);
    expect(d.changes).toEqual([]);
  });

  it('lists every change a real update would make', () => {
    const d = diffProposalAgainstRuleset(base);
    expect(d.breaking).toBe(true);
    expect(d.changes.join(' | ')).toMatch(/rate 4\.5500% → 3\.9900%/);
    expect(d.stateCode).toBe('NE');
    expect(d.current).not.toBeNull();
  });

  it('reports a new jurisdiction when the state is unknown', () => {
    const d = diffProposalAgainstRuleset({ ...base, stateCode: 'ZZ' });
    expect(d.breaking).toBe(true);
    expect(d.current).toBeNull();
    expect(d.changes.some(c => /new jurisdiction/.test(c))).toBe(true);
  });

  it('reports weight and schedule changes separately', () => {
    const d = diffProposalAgainstRuleset({
      ...base,
      stateCode: 'CA',
      schedule: { kind: 'bracketed', rate: 0.0884 },
      apportionmentWeights: { payroll: 1 / 3, property: 1 / 3, sales: 1 / 3 },
    });
    expect(d.changes.some(c => /schedule/.test(c))).toBe(true);
    expect(d.changes.some(c => /weights/.test(c))).toBe(true);
  });
});
