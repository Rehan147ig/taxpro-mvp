// Tests for the US quarterly interim provision (ASC 740-270 mechanics).
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { calculateInterimProvision } from '../us/quarterly.js';

describe('calculateInterimProvision — estimated AETR method', () => {
  it('allocates the annual estimate across quarters on YTD income', () => {
    const r = calculateInterimProvision({
      estimatedAnnualOrdinaryIncome: 1000,
      estimatedAnnualOrdinaryTax: 210, // 21% flat
      quarters: [
        { quarter: 1, ytdOrdinaryIncome: 200, taxRecognizedPriorQuarters: 0 },
        { quarter: 2, ytdOrdinaryIncome: 450, taxRecognizedPriorQuarters: 42 },
        { quarter: 3, ytdOrdinaryIncome: 700, taxRecognizedPriorQuarters: 94.5 },
        { quarter: 4, ytdOrdinaryIncome: 1000, taxRecognizedPriorQuarters: 147 },
      ],
    });
    expect(r.aetr.toNumber()).toBeCloseTo(0.21, 10);
    expect(r.annualizedIncomeUsed).toBe(false);
    const expense = r.quarters.map(q => q.quarterTaxExpense.toNumber());
    // 42, 94.5, 147, 210 − prior = 42, 52.5, 52.5, 63
    expect(expense[0]).toBeCloseTo(42, 10);
    expect(expense[1]).toBeCloseTo(52.5, 10);
    expect(expense[2]).toBeCloseTo(52.5, 10);
    expect(expense[3]).toBeCloseTo(63, 10);
    expect(r.totalYearToDateTax.toNumber()).toBeCloseTo(210, 10);
    expect(r.consistency.ok).toBe(true);
  });

  it('annualizes YTD income when no annual estimate is given', () => {
    const r = calculateInterimProvision({
      estimatedAnnualOrdinaryTax: 210,
      quarters: [{ quarter: 2, ytdOrdinaryIncome: 500, taxRecognizedPriorQuarters: 0 }],
    });
    // Annualized: 500 / (2/4) = 1000 → AETR 21%; YTD expense 105.
    expect(r.annualizedIncomeUsed).toBe(true);
    expect(r.aetr.toNumber()).toBeCloseTo(0.21, 10);
    expect(r.quarters[0].quarterTaxExpense.toNumber()).toBeCloseTo(105, 10);
  });

  it('recognizes discrete items in the quarter they occur', () => {
    const r = calculateInterimProvision({
      estimatedAnnualOrdinaryIncome: 1000,
      estimatedAnnualOrdinaryTax: 210,
      quarters: [
        { quarter: 1, ytdOrdinaryIncome: 200, ytdDiscreteItems: 0, taxRecognizedPriorQuarters: 0 },
        { quarter: 2, ytdOrdinaryIncome: 450, ytdDiscreteItems: 50, taxRecognizedPriorQuarters: 42 },
      ],
    });
    // Q2: YTD tax 94.5 + discrete current-quarter 50 − prior 42 = 102.5
    expect(r.quarters[1].discreteAdjustmentCurrentQuarter.toNumber()).toBeCloseTo(50, 10);
    expect(r.quarters[1].quarterTaxExpense.toNumber()).toBeCloseTo(102.5, 10);
  });

  it('handles a loss year estimate with AETR zero and an explanatory issue', () => {
    const r = calculateInterimProvision({
      estimatedAnnualOrdinaryIncome: -100,
      estimatedAnnualOrdinaryTax: 210,
      quarters: [{ quarter: 1, ytdOrdinaryIncome: -50, taxRecognizedPriorQuarters: 0 }],
    });
    expect(r.aetr.toNumber()).toBe(0);
    expect(r.quarters[0].quarterTaxExpense.toNumber()).toBe(0);
    expect(r.consistency.ok).toBe(false);
    expect(r.consistency.issues[0]).toMatch(/loss year/);
  });

  it('floors negative annual tax and flags missing estimates', () => {
    const r = calculateInterimProvision({
      estimatedAnnualOrdinaryTax: -5,
      quarters: [{ quarter: 1, ytdOrdinaryIncome: 100, taxRecognizedPriorQuarters: 0 }],
    });
    expect(r.aetr.toNumber()).toBe(0);
    expect(r.consistency.issues.some(i => /clamped to zero/.test(i))).toBe(true);
  });
});
