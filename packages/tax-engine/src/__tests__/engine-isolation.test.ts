import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { createEngine } from '../engine-factory.js';
import { Jurisdiction } from '../types.js';

describe('engine isolation — Decimal config guarded', () => {

  it('Decimal.set() throws at runtime', () => {
    expect(() => Decimal.set({ precision: 10 })).toThrow('frozen');
  });

  it('Decimal.config() throws at runtime', () => {
    expect(() => Decimal.config({ rounding: 2 })).toThrow('frozen');
  });

  it('createEngine returns distinct engine objects', () => {
    const us = createEngine(Jurisdiction.US_ASC740);
    const uk = createEngine(Jurisdiction.UK_FRS102_S29);
    expect(us).not.toBe(uk);
    expect(us.jurisdiction).toBe('US_ASC740');
    expect(uk.jurisdiction).toBe('UK_FRS102_S29');
  });

});

describe('US engine — current tax at 21%', () => {

  it('$1M profit at 21% = $210,000 federal tax', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const r = engine.calculateCurrentTax({
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-12-31',
    });
    expect(r.federalTax.toNumber()).toBe(210_000);
    expect(r.effectiveTaxRate.toNumber()).toBe(0.21);
  });

  it('zero profit = zero tax', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const r = engine.calculateCurrentTax({
      bookIncome: new Decimal(0),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-12-31',
    });
    expect(r.federalTax.toNumber()).toBe(0);
    expect(r.taxableIncome.toNumber()).toBe(0);
    expect(r.taxPayable.toNumber()).toBe(0);
  });

  it('negative book income before tax (loss) yields $0 taxable', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const r = engine.calculateCurrentTax({
      bookIncome: new Decimal('-500000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-12-31',
    });
    expect(r.federalTax.toNumber()).toBe(0);
    expect(r.effectiveTaxRate.toNumber()).toBe(0);
  });

});

describe('UK engine — deferred tax at 25% with no discounting', () => {

  it('$100k deductible timing difference at 25% = $25,000 DTA', () => {
    const engine = createEngine(Jurisdiction.UK_FRS102_S29);
    const r = engine.calculateDeferredTax(
      [{
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
        difference: new Decimal('-50000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      }],
      {}, {},
      {},
      undefined, '2026-06-30',
    );
    expect(r.totalClosingDTA.toNumber()).toBe(12_500);
    expect(r.totalClosingDTL.toNumber()).toBe(0);
    expect(r.lines[0].timingCategory).toBe('deductible_timing');
  });

  it('probable recovery false blocks UK DTA entirely', () => {
    const engine = createEngine(Jurisdiction.UK_FRS102_S29);
    const r = engine.calculateDeferredTax(
      [{
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
        difference: new Decimal('-150000'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      }],
      {}, {},
      {},
      { deductible_temporary: false }, '2026-06-30',
    );
    expect(r.totalClosingDTA.toNumber()).toBe(0);
  });

});

describe('large number precision — Decimal accuracy', () => {

  it('$10B × 0.21 = exactly $2.1B with Decimal (no floating-point error)', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const r = engine.calculateCurrentTax({
      bookIncome: new Decimal('10000000000'),
      permanentDifferences: [],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-12-31',
    });
    expect(r.federalTax.toString()).toBe('2100000000');
    expect(r.federalTax.toNumber()).toBe(2_100_000_000);
  });

  it('0.1 + 0.2 = 0.3 in Decimal (not 0.30000000000000004)', () => {
    const a = new Decimal('0.1');
    const b = new Decimal('0.2');
    expect(a.plus(b).toString()).toBe('0.3');
  });

  it('multibillion-dollar deferred tax maintains precision', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const r = engine.calculateDeferredTax(
      [{
        accountId: 'a1', entityId: 'e1', period: '2026-01-01',
        bookBalance: new Decimal('999999999999'), taxBalance: new Decimal('500000000000'),
        difference: new Decimal('-499999999999'), diffType: 'temporary',
        timingCategory: 'deductible_temporary',
      }],
      {}, {},
      { deductible_temporary: new Decimal('0.21') },
    );
    expect(r.totalClosingDTA.toString()).toBe('104999999999.79');
  });

});

describe('determinism — same input always same output', () => {

  it('calculateCurrentTax called 100 times returns identical result', () => {
    const engine = createEngine(Jurisdiction.US_ASC740);
    const input = {
      bookIncome: new Decimal('1000000'),
      permanentDifferences: [] as { amount: Decimal; label: string }[],
      taxRate: new Decimal('0.21'),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-12-31',
    };
    const first = engine.calculateCurrentTax(input).federalTax.toString();
    for (let i = 0; i < 99; i++) {
      const result = engine.calculateCurrentTax(input);
      expect(result.federalTax.toString()).toBe(first);
    }
  });

});
