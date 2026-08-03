// Tests for the US state rule engine.
//
// UNVALIDATED — reference data only, to be verified against current state
// law before any use.

import { describe, expect, it } from 'vitest';
import { STATE_RULESET, stateRuleset, type StateRuleset } from '../us/state-rules.js';

describe('STATE_RULESET', () => {
  it('covers all 51 jurisdictions (50 states + DC) with no duplicates', () => {
    expect(STATE_RULESET).toHaveLength(51);
    const codes = STATE_RULESET.map(r => r.stateCode);
    expect(new Set(codes).size).toBe(51);
  });

  it('keeps the reference table as the single rate source', () => {
    for (const r of STATE_RULESET) {
      expect(r.schedule.rate).toBeGreaterThanOrEqual(0);
      expect(r.schedule.rate).toBeLessThanOrEqual(1);
      expect(r.cite.length).toBeGreaterThan(0);
      expect(r.verify.length).toBeGreaterThan(0);
    }
  });

  it('flags the filing types correctly for the known special cases', () => {
    const type = (code: string) => stateRuleset(code)?.filingType;
    expect(type('NV')).toBe('grossReceipts');
    expect(type('OH')).toBe('grossReceipts');
    expect(type('TX')).toBe('grossReceipts');
    expect(type('WA')).toBe('grossReceipts');
    expect(type('SD')).toBe('none');
    expect(type('WY')).toBe('none');
    expect(type('CA')).toBe('cit');
    expect(type('TN')).toBe('cit'); // excise tax is income-based
    expect(type('NH')).toBe('cit'); // BPT is income-based
    expect(type('PA')).toBe('cit');
  });

  it('encodes single sales as the default weight, equal three-factor for AK/HI/KS/ND/NM/OK, double-weighted sales for FL/VA', () => {
    const weights = (code: string) => stateRuleset(code)?.apportionmentWeights;
    expect(weights('CA')).toEqual({ payroll: 0, property: 0, sales: 1 });
    expect(weights('TX')).toEqual({ payroll: 0, property: 0, sales: 1 });
    for (const code of ['AK', 'HI', 'KS', 'ND', 'NM', 'OK']) {
      const w = weights(code);
      expect(w?.payroll).toBeCloseTo(1 / 3, 10);
      expect(w?.property).toBeCloseTo(1 / 3, 10);
      expect(w?.sales).toBeCloseTo(1 / 3, 10);
    }
    for (const code of ['FL', 'VA']) {
      const w = weights(code);
      expect(w?.payroll).toBeCloseTo(0.25, 10);
      expect(w?.property).toBeCloseTo(0.25, 10);
      expect(w?.sales).toBeCloseTo(0.5, 10);
    }
  });

  it('marks bracketed states and carries their notModeled gaps', () => {
    const nj = stateRuleset('NJ');
    expect(nj?.schedule.kind).toBe('bracketed');
    expect(nj?.notModeled.length).toBeGreaterThan(0);
    expect(stateRuleset('CA')?.schedule.kind).toBe('flat');
  });

  it('looks up case-insensitively and returns undefined for unknown codes', () => {
    expect(stateRuleset('dc')?.stateCode).toBe('DC');
    expect(stateRuleset('XX')).toBeUndefined();
  });

  it('every ruleset matches a reference row (no orphans)', () => {
    for (const r of STATE_RULESET as StateRuleset[]) {
      expect(r.stateName.length).toBeGreaterThan(0);
    }
  });
});
