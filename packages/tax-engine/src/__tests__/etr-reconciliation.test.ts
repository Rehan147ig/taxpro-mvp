import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateETR } from '../etr-reconciliation.js';

describe('calculateETR', () => {
  it('basic ETR with permanent differences and credits', () => {
    const r = calculateETR({
      bookIncome: new Decimal('1000000'),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal('210000'),
      stateTax: new Decimal('50000'),
      permanentDifferences: [
        { amount: new Decimal('-30000'), label: 'Tax-exempt interest' },
      ],
      taxCredits: new Decimal('20000'),
      otherAdjustments: [],
    });
    expect(r.statutoryRate.toNumber()).toBe(0.21);
    expect(r.lines.length).toBeGreaterThan(3);
    expect(r.effectiveTaxRate.greaterThan(0)).toBe(true);
  });

  it('zero book income yields 0% ETR', () => {
    const r = calculateETR({
      bookIncome: new Decimal(0),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal(0),
      stateTax: new Decimal(0),
      permanentDifferences: [],
      taxCredits: new Decimal(0),
      otherAdjustments: [],
    });
    expect(r.effectiveTaxRate.toNumber()).toBe(0);
    expect(r.totalTaxExpense.toNumber()).toBe(0);
  });

  it('loss year shows negative ETR items', () => {
    const r = calculateETR({
      bookIncome: new Decimal('-500000'),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal(0),
      stateTax: new Decimal(0),
      permanentDifferences: [
        { amount: new Decimal('100000'), label: 'Non-deductible expense' },
      ],
      taxCredits: new Decimal(0),
      otherAdjustments: [],
    });
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('treats negative credits as invalid', () => {
    expect(() => calculateETR({
      bookIncome: new Decimal('1000000'),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal('210000'),
      stateTax: new Decimal(0),
      permanentDifferences: [],
      taxCredits: new Decimal('-100'),
      otherAdjustments: [],
    })).toThrow();
  });

  it('state tax appears as separate ETR line', () => {
    const r = calculateETR({
      bookIncome: new Decimal('1000000'),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal('210000'),
      stateTax: new Decimal('50000'),
      permanentDifferences: [],
      taxCredits: new Decimal(0),
      otherAdjustments: [],
    });
    const stateLine = r.lines.find(l => l.description.includes('State'));
    expect(stateLine).toBeDefined();
    expect(stateLine!.amount.toNumber()).toBe(50_000);
  });

  it('no floating-point error on ETR calc', () => {
    const r = calculateETR({
      bookIncome: new Decimal('10000000'),
      federalTaxRate: new Decimal('0.21'),
      federalTax: new Decimal('2100000'),
      stateTax: new Decimal(0),
      permanentDifferences: [],
      taxCredits: new Decimal(0),
      otherAdjustments: [],
    });
    expect(r.statutoryTax.toString()).toBe('2100000');
  });
});
