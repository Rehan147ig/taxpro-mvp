import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import * as publicApi from '../index.js';
import { shouldDiscount, getRateForFiscalYear, UK_RATES_BY_FISCAL_YEAR, US_RATES_BY_FISCAL_YEAR } from '../uk-frs102-s29/rules.js';
import { Jurisdiction } from '../types.js';
import { calculateDeferredTax, calculateDeferredTaxLine } from '../deferred-tax.js';
import { createEngine } from '../engine-factory.js';
import type { BookTaxDifference } from '../types.js';

describe('no-duplicate-engines regression guard', () => {

  it('exports exactly one calculateDeferredTax from the package public surface', () => {
    expect(typeof publicApi.calculateDeferredTax).toBe('function');
    expect(typeof publicApi.calculateDeferredTaxLine).toBe('function');
    expect(publicApi.calculateDeferredTax.name).toBe('calculateDeferredTax');
    expect(publicApi.calculateDeferredTaxLine.name).toBe('calculateDeferredTaxLine');
  });

  it('delegates UK jurisdiction to the uk-frs102-s29 implementation', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
        difference: new Decimal('-50000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];
    const ukResult = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29, undefined, '2026-06-30');
    const usResult = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.US_ASC740, undefined, '2026-06-30');
    expect(ukResult.totalClosingDTA.toNumber()).toBe(12_500);
    expect(usResult.totalClosingDTA.toNumber()).toBe(10_500);
    expect(ukResult.lines[0].timingCategory).toBe('deductible_timing');
    expect(usResult.lines[0].timingCategory).toBe('deductible_temporary');
  });

  it('blocks UK DTA when probable recovery is false via delegation', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];
    const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29, { deductible_temporary: false }, '2026-06-30');
    expect(r.totalClosingDTA.toNumber()).toBe(0);
    expect(r.lines[0].deferredTaxAmount.toNumber()).toBe(0);
  });
});

describe('createEngine factory', () => {

  it('creates a US engine with bound jurisdiction', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    expect(engine.jurisdiction).toBe(Jurisdiction.US_ASC740);
    expect(typeof engine.calculateCurrentTax).toBe('function');
    expect(typeof engine.calculateDeferredTax).toBe('function');
    expect(typeof engine.calculateETR).toBe('function');
  });

  it('creates a UK engine with bound jurisdiction', () => {
    const engine = createEngine(Jurisdiction.UK_FRS102_S29);
    expect(engine.jurisdiction).toBe(Jurisdiction.UK_FRS102_S29);
  });

  it('US and UK engines produce different deferred tax from same input', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
        difference: new Decimal('-50000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];
    const usEngine = createEngine(Jurisdiction.US_ASC740);
    const ukEngine = createEngine(Jurisdiction.UK_FRS102_S29);

    const usResult = usEngine.calculateDeferredTax(diffs, {}, {}, {}, undefined, '2026-06-30');
    const ukResult = ukEngine.calculateDeferredTax(diffs, {}, {}, {}, undefined, '2026-06-30');

    expect(usResult.totalClosingDTA.toNumber()).toBe(10_500);
    expect(ukResult.totalClosingDTA.toNumber()).toBe(12_500);
  });

  it('UK engine blocks DTA when probable recovery is false', () => {
    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];
    const ukEngine = createEngine(Jurisdiction.UK_FRS102_S29);
    const r = ukEngine.calculateDeferredTax(diffs, {}, {}, {}, { deductible_temporary: false }, '2026-06-30');
    expect(r.totalClosingDTA.toNumber()).toBe(0);
  });

  it('calculateDeferredTaxLine binds jurisdiction via factory', () => {
    const usEngine = createEngine(Jurisdiction.US_ASC740);
    const ukEngine = createEngine(Jurisdiction.UK_FRS102_S29);

    const input = {
      entityId: 'e1',
      timingCategory: 'taxable_temporary',
      openingDTA: new Decimal(0),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('100000'),
      taxRate: new Decimal('0.25'),
      dtType: 'DTL' as const,
    };

    const usLine = usEngine.calculateDeferredTaxLine(input);
    const ukLine = ukEngine.calculateDeferredTaxLine(input);

    expect(usLine.timingCategory).toBe('taxable_temporary');
    expect(ukLine.timingCategory).toBe('taxable_timing');
  });

});

describe('Decimal config isolation', () => {

  it('Decimal.set throws to prevent cross-jurisdiction config contamination', () => {
    expect(() => Decimal.set({ precision: 10 })).toThrow('frozen');
  });

  it('Decimal.config throws to prevent cross-jurisdiction config contamination', () => {
    expect(() => Decimal.config({ precision: 10 })).toThrow('frozen');
  });

});

describe('shouldDiscount branching', () => {

  it('UK_FRS102_S29 should NOT discount (FRS 102 29.17)', () => {
    expect(shouldDiscount(Jurisdiction.UK_FRS102_S29)).toBe(false);
  });

  it('produces discountFactor=1 for UK (no discounting)', async () => {
    const { ukDeferredTaxLine } = await import('../uk-frs102-s29/deferred-tax.js');
    const r = ukDeferredTaxLine({
      entityId: 'e1',
      timingCategory: 'taxable_temporary',
      openingDTA: new Decimal(0),
      openingDTL: new Decimal(0),
      currentYearTemporaryChange: new Decimal('100000'),
      taxRate: new Decimal('0.25'),
      dtType: 'DTL',
      jurisdiction: Jurisdiction.UK_FRS102_S29,
    });
    expect(r.deferredTaxAmount.toNumber()).toBe(25_000);
  });
});

describe('rate table wiring', () => {

  it('UK rate for fiscal year 2026 comes from UK_RATES_BY_FISCAL_YEAR', () => {
    const rate = getRateForFiscalYear('UK_FRS102_S29', '2026', {}, UK_RATES_BY_FISCAL_YEAR);
    expect(rate.toNumber()).toBe(0.25);
  });

  it('US rate for fiscal year 2026 comes from US_RATES_BY_FISCAL_YEAR', () => {
    const rate = getRateForFiscalYear('US_ASC740', '2026', {}, US_RATES_BY_FISCAL_YEAR);
    expect(rate.toNumber()).toBe(0.21);
  });

  it('changing UK_RATES_BY_FISCAL_YEAR propagates to calculation output', () => {
    const originalRates = { ...UK_RATES_BY_FISCAL_YEAR };
    UK_RATES_BY_FISCAL_YEAR['2026'] = new Decimal('0.30');

    const diffs: BookTaxDifference[] = [
      {
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
        difference: new Decimal('-50000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      },
    ];
    const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29, undefined, '2026-06-30');
    expect(r.totalClosingDTA.toNumber()).toBe(15_000);

    UK_RATES_BY_FISCAL_YEAR['2026'] = originalRates['2026'];
  });

  it('category-specific rate from taxRates map takes priority over year table', () => {
    const rate = getRateForFiscalYear('US_ASC740', '2026', { deductible_temporary: new Decimal('0.15') }, US_RATES_BY_FISCAL_YEAR, 'deductible_temporary');
    expect(rate.toNumber()).toBe(0.15);
  });
});
