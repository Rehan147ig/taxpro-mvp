// Tests for the US 50-state reference table.
//
// UNVALIDATED — reference data only, to be verified against current state
// law before any use.

import { describe, expect, it } from 'vitest';
import { STATE_TAX_REFERENCE, stateTaxReference } from '../us/state-rates.js';

describe('STATE_TAX_REFERENCE', () => {
  it('covers all 50 states plus DC', () => {
    expect(STATE_TAX_REFERENCE).toHaveLength(51);
  });

  it('has unique state codes', () => {
    const codes = STATE_TAX_REFERENCE.map(s => s.stateCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('looks up a state case-insensitively', () => {
    const ca = stateTaxReference('ca');
    expect(ca?.stateCode).toBe('CA');
    expect(ca?.topRate).toBe(0.0884);
  });

  it('flags the no-CIT states explicitly', () => {
    for (const code of ['NV', 'SD', 'WY', 'OH', 'TX', 'WA']) {
      const s = stateTaxReference(code);
      expect(s?.topRate).toBe(0);
      expect(s?.rateNotes).toMatch(/NO CIT|NO corporate income tax/);
    }
  });

  it('returns undefined for unknown codes', () => {
    expect(stateTaxReference('XX')).toBeUndefined();
  });

  it('never stores an apportionment fraction outside [0,1]', () => {
    for (const s of STATE_TAX_REFERENCE) {
      expect(s.topRate).toBeGreaterThanOrEqual(0);
      expect(s.topRate).toBeLessThanOrEqual(1);
    }
  });
});
