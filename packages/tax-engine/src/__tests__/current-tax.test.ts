import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateCurrentTax } from '../current-tax.js';

describe('calculateCurrentTax', () => {
  it('basic calculation: $1M income at 21%', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    expect(r.federalTax.toNumber()).toBe(210_000);
    expect(r.effectiveTaxRate.toNumber()).toBe(0.21);
    expect(r.taxPayable.toNumber()).toBe(210_000);
  });

  it('permanent differences adjust taxable income', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [
        { amount: new Decimal('-50000'), label: 'Tax-exempt interest' },
        { amount: new Decimal('20000'), label: 'Non-deductible meals' },
      ],
      taxRate: new Decimal('0.21'),
      stateTaxRate: new Decimal('0.05'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    expect(r.totalPermanentAdjustments.toNumber()).toBe(-30_000);
    expect(r.taxableIncome.toNumber()).toBe(970_000);
    expect(r.stateTax.greaterThan(0)).toBe(true);
  });

  it('tax credits and NOL reduce tax to zero', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal('50000'),
      estimatedPayments: new Decimal('100000'),
      nolUtilization: new Decimal('200000'),
      asOfDate: '2026-01-01',
    });
    expect(r.totalTaxAfterCredits.toNumber()).toBe(0);
    expect(r.taxPayable.toNumber()).toBe(0);
  });

  it('loss year: zero book income yields $0 taxable income', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('-500000'),
      permanentDifferences: [{ amount: new Decimal('10000'), label: 'Perm adj' }],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    expect(r.taxableIncome.toNumber()).toBe(0);
    expect(r.federalTax.toNumber()).toBe(0);
    expect(r.effectiveTaxRate.toNumber()).toBe(0);
  });

  it('state tax is correctly apportioned at 15% default', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('2000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      stateTaxRate: new Decimal('0.07'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    // State: 2M * 0.15 * 0.07 = 21,000
    expect(r.stateTax.toNumber()).toBe(21_000);
  });

  it('negative tax credits are rejected', () => {
    expect(() => calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal('-100'),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    })).toThrow('taxCredits cannot be negative');
  });

  it('negative NOL utilization is rejected', () => {
    expect(() => calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal('-100'),
      asOfDate: '2026-01-01',
    })).toThrow('nolUtilization cannot be negative');
  });

  it('tax rate over 100% is rejected', () => {
    expect(() => calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('1.5'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    })).toThrow('taxRate must be between 0 and 1');
  });

  it('zero everything returns all zeros', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal(0),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    expect(r.federalTax.toNumber()).toBe(0);
    expect(r.taxPayable.toNumber()).toBe(0);
    expect(r.effectiveTaxRate.toNumber()).toBe(0);
  });

  it('no floating-point rounding error ($10M × 0.21 = exactly $2.1M)', () => {
    const r = calculateCurrentTax({
      bookIncome: new Decimal('10000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });
    expect(r.federalTax.toString()).toBe('2100000');
  });
});
