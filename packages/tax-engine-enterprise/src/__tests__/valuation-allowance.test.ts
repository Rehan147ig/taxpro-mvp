// Tests for the US valuation allowance scheduler.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { scheduleValuationAllowance } from '../us/valuation-allowance.js';

const SOURCES = [
  { id: 'NOL-FY2024', kind: 'nol' as const, balance: 400, expiryYear: 2035, expectedReversalYear: 2030 },
  { id: 'R&D-credit', kind: 'credit' as const, balance: 300, expiryYear: 2030, expectedReversalYear: 2029 },
  { id: 'depreciation', kind: 'temporary' as const, balance: 300, expiryYear: 0, expectedReversalYear: 2028 },
];

describe('scheduleValuationAllowance', () => {
  it('allocates a full allowance across the assets and nets the balance', () => {
    const r = scheduleValuationAllowance({ sources: SOURCES, valuationAllowance: 400 });
    expect(r.grossDeferredTaxAssets.toNumber()).toBe(1000);
    expect(r.totalAllowance.toNumber()).toBe(400);
    expect(r.netDeferredTaxAssets.toNumber()).toBe(600);
    // Pro-rata by default ordering: oldest expiry first (depreciation 2028, R&D 2030, NOL 2035).
    expect(r.sources[0].id).toBe('depreciation');
    expect(r.sources[0].allowanceApplied.toNumber()).toBe(300);
    expect(r.sources[1].id).toBe('R&D-credit');
    expect(r.sources[1].allowanceApplied.toNumber()).toBe(100);
    expect(r.sources[2].allowanceApplied.toNumber()).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('honors an explicit allocation order', () => {
    const r = scheduleValuationAllowance({
      sources: SOURCES,
      valuationAllowance: 400,
      allocationOrder: ['R&D-credit', 'NOL-FY2024', 'depreciation'],
    });
    expect(r.sources.map(s => s.id)).toEqual(['R&D-credit', 'NOL-FY2024', 'depreciation']);
    expect(r.sources[0].allowanceApplied.toNumber()).toBe(300);
    expect(r.sources[1].allowanceApplied.toNumber()).toBe(100);
  });

  it('clamps an allowance above the gross assets and warns', () => {
    const r = scheduleValuationAllowance({ sources: SOURCES, valuationAllowance: 5000 });
    expect(r.totalAllowance.toNumber()).toBe(1000);
    expect(r.netDeferredTaxAssets.toNumber()).toBe(0);
    expect(r.warnings.map(w => w.kind)).toContain('allowance_exceeds_assets');
  });

  it('flags sources that expire before their expected reversal year', () => {
    const r = scheduleValuationAllowance({
      sources: [
        { id: 'R&D-credit', kind: 'credit' as const, balance: 300, expiryYear: 2030, expectedReversalYear: 2031 },
      ],
      valuationAllowance: 0,
    });
    expect(r.warnings.map(w => w.kind)).toContain('expires_before_reversal');
    expect(r.sources.find(s => s.id === 'R&D-credit')?.expiresBeforeReversal).toBe(true);
  });

  it('handles negative balances with a warning, treating them as zero', () => {
    const r = scheduleValuationAllowance({
      sources: [{ id: 'bad', kind: 'other' as const, balance: -100, expiryYear: 0, expectedReversalYear: 0 }],
      valuationAllowance: 0,
    });
    expect(r.warnings.map(w => w.kind)).toContain('negative_balance');
    expect(r.sources[0].grossBalance.toNumber()).toBe(0);
    expect(r.grossDeferredTaxAssets.toNumber()).toBe(0);
  });
});
