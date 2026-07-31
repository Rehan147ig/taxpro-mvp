import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createEngine } from '../engine-factory.js';
import { Jurisdiction } from '../types.js';
import { calculateUkMarginalRelief } from './rules.js';
import { calculateUkCurrentTax } from './current-tax.js';

const money = (v: string | number) => new Decimal(v);
const rate = (v: string | number) => new Decimal(v);

function ukInput(overrides: Partial<Parameters<typeof calculateUkCurrentTax>[0]> = {}) {
  return {
    bookIncome: money('100000'),
    permanentDifferences: [],
    taxRate: rate('0.25'),
    taxCredits: money(0),
    estimatedPayments: money(0),
    nolUtilization: money(0),
    asOfDate: '2026-12-31',
    ...overrides,
  };
}

describe('calculateUkMarginalRelief — HMRC published values', () => {
  it('taxes profits at 19% at or below the small profits limit', () => {
    expect(calculateUkMarginalRelief(money(40000)).tax.toNumber()).toBe(7600);
    expect(calculateUkMarginalRelief(money(50000)).tax.toNumber()).toBe(9500);
  });

  it('applies marginal relief in the £50k–£250k band (published example: £125k → £29,375)', () => {
    const r = calculateUkMarginalRelief(money(125000));
    expect(r.tax.toNumber()).toBe(29375);
    expect(r.marginalRelief.toNumber()).toBe(1875); // 0.015 × (250k − 125k)
    expect(r.effectiveRate.toNumber()).toBeCloseTo(0.235, 3);
  });

  it('mid-band: £100k → 25% − 0.015×(250k−100k) = 22,750', () => {
    const r = calculateUkMarginalRelief(money(100000));
    expect(r.tax.toNumber()).toBe(22750);
    expect(r.effectiveRate.toNumber()).toBeCloseTo(0.2275, 4);
  });

  it('taxes profits at 25% at and above the upper limit', () => {
    expect(calculateUkMarginalRelief(money(250000)).tax.toNumber()).toBe(62500);
    expect(calculateUkMarginalRelief(money(300000)).tax.toNumber()).toBe(75000);
  });

  it('zero and negative profits produce zero tax', () => {
    expect(calculateUkMarginalRelief(money(0)).tax.toNumber()).toBe(0);
    expect(calculateUkMarginalRelief(money(-10000)).tax.toNumber()).toBe(0);
  });

  it('scales limits by associated companies (2 associates → 25k/125k)', () => {
    // At P = 25k (new small limit): 6,250 − 0.015 × (125k − 25k) = 4,750 = 19% ✓
    const atLower = calculateUkMarginalRelief(money(25000), 2);
    expect(atLower.tax.toNumber()).toBe(4750);
    // At P = 60k: 15,000 − 0.015 × 65,000 = 14,025
    const mid = calculateUkMarginalRelief(money(60000), 2);
    expect(mid.tax.toNumber()).toBe(14025);
  });

  it('rejects invalid associated company counts', () => {
    expect(() => calculateUkMarginalRelief(money(100000), 0)).toThrow(/positive integer/);
    expect(() => calculateUkMarginalRelief(money(100000), 1.5)).toThrow(/positive integer/);
  });
});

describe('calculateUkCurrentTax', () => {
  it('computes marginal relief on taxable income (book + permanent)', () => {
    const result = calculateUkCurrentTax(ukInput({ bookIncome: money(100000) }));
    expect(result.federalTax.toNumber()).toBe(22750);
    expect(result.marginalRelief?.toNumber()).toBe(2250);
    expect(result.totalTaxAfterCredits.toNumber()).toBe(22750);
  });

  it('applies 19% when profits are within the small profits limit', () => {
    const result = calculateUkCurrentTax(ukInput({ bookIncome: money(40000) }));
    expect(result.federalTax.toNumber()).toBe(7600);
    expect(result.marginalRelief?.toNumber()).toBe(0);
    expect(result.effectiveTaxRate.toNumber()).toBeCloseTo(0.19, 4);
  });

  it('deducts credits and NOL after marginal relief', () => {
    const result = calculateUkCurrentTax(ukInput({
      bookIncome: money(100000),
      taxCredits: money(1000),
      nolUtilization: money(2000),
      estimatedPayments: money(5000),
    }));
    expect(result.totalTaxBeforeCredits.toNumber()).toBe(22750);
    expect(result.totalTaxAfterCredits.toNumber()).toBe(19750);
    expect(result.taxPayable.toNumber()).toBe(14750);
  });

  it('accounts for permanent differences in the taxable base', () => {
    const result = calculateUkCurrentTax(ukInput({
      bookIncome: money(100000),
      permanentDifferences: [{ amount: money(50000), label: 'disallowed' }],
    }));
    expect(result.taxableIncome.toNumber()).toBe(150000);
    expect(result.federalTax.toNumber()).toBe(37500 - 0.015 * (250000 - 150000)); // 36,000
  });

  it('caps tax at zero when credits exceed the charge', () => {
    const result = calculateUkCurrentTax(ukInput({
      bookIncome: money(100000),
      taxCredits: money(30000),
    }));
    expect(result.totalTaxAfterCredits.toNumber()).toBe(0);
  });

  it('returns the main rate in federalTaxRate for disclosure', () => {
    const result = calculateUkCurrentTax(ukInput());
    expect(result.federalTaxRate.toNumber()).toBe(0.25);
  });
});

describe('engine factory jurisdiction dispatch', () => {
  it('uses marginal relief for UK engines', () => {
    const ukEngine = createEngine(Jurisdiction.UK_FRS102_S29);
    const result = ukEngine.calculateCurrentTax({
      bookIncome: money(125000),
      permanentDifferences: [],
      taxRate: rate('0.25'),
      taxCredits: money(0),
      estimatedPayments: money(0),
      nolUtilization: money(0),
      asOfDate: '2026-12-31',
    });
    expect(result.federalTax.toNumber()).toBe(29375);
  });

  it('keeps the flat 21% US path unchanged', () => {
    const usEngine = createEngine(Jurisdiction.US_ASC740);
    const result = usEngine.calculateCurrentTax({
      bookIncome: money(125000),
      permanentDifferences: [],
      taxRate: rate('0.21'),
      taxCredits: money(0),
      estimatedPayments: money(0),
      nolUtilization: money(0),
      asOfDate: '2026-12-31',
    });
    expect(result.federalTax.toNumber()).toBe(26250);
    expect(result.marginalRelief).toBeUndefined();
  });
});
