// Tests for the GL narration heuristics.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { flagGlTransaction, GL_HEURISTIC_RULES } from '../elt/heuristics.js';

describe('flagGlTransaction', () => {
  it('flags entertainment narration', () => {
    const findings = flagGlTransaction({ narration: 'Client dinner at Italian restaurant' });
    expect(findings.some((f) => f.flag === 'NON_DEDUCTIBLE_ENTERTAINMENT')).toBe(true);
    expect(findings.some((f) => f.severity === 'hard_flag')).toBe(true);
  });

  it('flags penalties and fines narration', () => {
    const findings = flagGlTransaction({ narration: 'IRS late filing penalty' });
    expect(findings.some((f) => f.flag === 'PENALTIES_OR_FINES')).toBe(true);
  });

  it('flags gift narration', () => {
    const findings = flagGlTransaction({ narration: 'Christmas gift basket for client' });
    expect(findings.some((f) => f.flag === 'GIFTS_LIMITED_DEDUCTION')).toBe(true);
  });

  it('flags hotel narration at review severity', () => {
    const findings = flagGlTransaction({ narration: 'Hotel stay - Boston conference' });
    const hotel = findings.find((f) => f.flag === 'HOTEL_LODGING_REVIEW');
    expect(hotel).toBeDefined();
    expect(hotel!.severity).toBe('review');
    expect(findings.some((f) => f.severity === 'hard_flag')).toBe(false);
  });

  it('flags empty narration', () => {
    const findings = flagGlTransaction({ narration: '   ' });
    expect(findings.some((f) => f.flag === 'EMPTY_NARRATION')).toBe(true);
  });

  it('adds a review note when tax tag overrides exist', () => {
    const findings = flagGlTransaction({ narration: 'Office supplies', taxTagOverrides: ['promotional'] });
    expect(findings.some((f) => f.flag === 'TAX_TAG_OVERRIDE')).toBe(true);
  });

  it('does not flag clean office-supply narration', () => {
    const findings = flagGlTransaction({ narration: 'Office supplies - reorder' });
    expect(findings).toHaveLength(0);
  });

  it('keeps matched text for regex findings', () => {
    const findings = flagGlTransaction({ narration: 'paid a parking ticket downtown' });
    const match = findings.find((f) => f.flag === 'PENALTIES_OR_FINES');
    expect(match!.matchedText).toBe('parking ticket');
  });

  it('is deterministic across repeated calls', () => {
    const narration = 'Client meal and hotel stay';
    const a = flagGlTransaction({ narration });
    const b = flagGlTransaction({ narration });
    expect(a.map((f) => f.flag)).toEqual(b.map((f) => f.flag));
  });

  it('every rule carries the required verify note', () => {
    for (const rule of GL_HEURISTIC_RULES) {
      expect(rule.verifyNote).toContain('guessed pattern — verify against real narration text from an actual ERP export before trusting.');
    }
  });
});
