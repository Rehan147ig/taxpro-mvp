import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateDeferredTax, calculateDeferredTaxLine } from '../deferred-tax.js';
import type { BookTaxDifference } from '../types.js';

describe('calculateDeferredTaxLine', () => {
  it('creates a DTA line correctly', () => {
    const r = calculateDeferredTaxLine({
      entityId: 'e1',
      timingCategory: 'deductible_temporary',
      openingDTA: new Decimal(0),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('-100000'),
      taxRate: new Decimal('0.21'),
      dtType: 'DTA',
    });
    expect(r.deferredTaxAmount.toNumber()).toBe(21_000);
    expect(r.closingBalance.toNumber()).toBe(21_000);
    expect(r.dtType).toBe('DTA');
  });

  it('creates a DTL line correctly', () => {
    const r = calculateDeferredTaxLine({
      entityId: 'e1',
      timingCategory: 'taxable_temporary',
      openingDTA: new Decimal(0),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('200000'),
      taxRate: new Decimal('0.21'),
      dtType: 'DTL',
    });
    expect(r.deferredTaxAmount.toNumber()).toBe(42_000);
    expect(r.closingBalance.toNumber()).toBe(42_000);
  });

  it('handles prior year opening balances', () => {
    const r = calculateDeferredTaxLine({
      entityId: 'e1',
      timingCategory: 'deductible_temporary',
      openingDTA: new Decimal('21000'),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('-50000'),
      taxRate: new Decimal('0.21'),
      dtType: 'DTA',
    });
    expect(r.openingBalance.toNumber()).toBe(21_000);
    expect(r.closingBalance.toNumber()).toBe(31_500);
  });

  it('invalid rate is rejected', () => {
    expect(() => calculateDeferredTaxLine({
      entityId: 'e1',
      timingCategory: 'deductible_temporary',
      openingDTA: new Decimal(0),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('-100000'),
      taxRate: new Decimal('1.5'),
      dtType: 'DTA',
    })).toThrow();
  });
});

describe('calculateDeferredTax (full)', () => {
  it('computes DTA and DTL from temporary differences', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
      {
        accountId: 'a2', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('800000'), taxBalance: new Decimal('1000000'),
        difference: new Decimal('200000'), diffType: 'temporary',
        timingCategory: 'taxable_temporary',
      },
    ];

    const r = calculateDeferredTax(diffs, {}, {}, {
      deductible_temporary: new Decimal('0.21'),
      taxable_temporary: new Decimal('0.21'),
    });

    expect(r.totalClosingDTA.toNumber()).toBe(31_500);
    expect(r.totalClosingDTL.toNumber()).toBe(42_000);
    expect(r.totalOpeningDTA.toNumber()).toBe(0);
    expect(r.totalOpeningDTL.toNumber()).toBe(0);
    expect(r.netDeferredTaxExpense.toNumber()).toBe(10_500); // DTL 42k - DTA 31.5k
  });

  it('handles prior year balances correctly', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];

    const r = calculateDeferredTax(diffs,
      { deductible_temporary: new Decimal('21000') },
      {},
      { deductible_temporary: new Decimal('0.21') },
    );

    expect(r.totalOpeningDTA.toNumber()).toBe(21_000);
    expect(r.totalClosingDTA.toNumber()).toBe(52_500);
  });

  it('skips non-temporary differences', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('100000'), taxBalance: new Decimal('100000'),
        difference: new Decimal(0), diffType: 'no_diff',
      },
    ];

    const r = calculateDeferredTax(diffs, {}, {}, {});
    expect(r.lines.length).toBe(0);
    expect(r.totalClosingDTA.toNumber()).toBe(0);
    expect(r.totalClosingDTL.toNumber()).toBe(0);
  });

  it('returns zero for empty temporary differences', () => {
    const r = calculateDeferredTax([], {}, {}, {});
    expect(r.lines.length).toBe(0);
    expect(r.netDeferredTaxExpense.toNumber()).toBe(0);
  });

  it('aggregates multiple accounts into same category', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
      {
        accountId: 'a2', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('300000'), taxBalance: new Decimal('200000'),
        difference: new Decimal('-100000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];

    const r = calculateDeferredTax(diffs, {}, {}, {
      deductible_temporary: new Decimal('0.21'),
    });

    // 250k * 0.21 = 52,500 aggregated
    expect(r.lines.length).toBe(1);
    expect(r.totalClosingDTA.toNumber()).toBe(52_500);
  });
});
