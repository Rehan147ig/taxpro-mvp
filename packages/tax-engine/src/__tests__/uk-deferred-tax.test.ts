import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculateDeferredTaxLine, calculateDeferredTax } from '../deferred-tax.js';
import { Jurisdiction } from '../types.js';
import { ukDeferredTaxLine, calculateUkDeferredTax } from '../uk-frs102-s29/deferred-tax.js';
import type { BookTaxDifference } from '../types.js';

describe('UK FRS 102 Section 29 — Deferred Tax', () => {
  describe('ukDeferredTaxLine (no discounting)', () => {
    it('does not discount deferred tax amount (discountFactor = 1)', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'deductible_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('-100000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTA',
        probableRecovery: true,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(25_000);
      expect(r.closingBalance.toNumber()).toBe(25_000);
      expect(r.dtType).toBe('DTA');
    });

    it('creates a DTL line (liability)', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'taxable_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('200000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTL',
        probableRecovery: true,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(50_000);
      expect(r.deferredTaxAmount.toNumber()).toBe(50_000);
    });

    it('uses timing difference terminology in labels', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'deductible_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('-50000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTA',
        probableRecovery: true,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.timingCategory).toBe('deductible_timing');
    });
  });

  describe('probable recovery check', () => {
    it('returns zero DTA when probableRecovery is false', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'deductible_temporary',
        openingDTA: new Decimal(25000),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('-100000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTA',
        probableRecovery: false,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(0);
      expect(r.closingBalance.toNumber()).toBe(0);
    });

    it('does not block DTL when probableRecovery is false', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'taxable_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('100000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTL',
        probableRecovery: false,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(25_000);
    });

    it('allows DTA when probableRecovery is true', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'deductible_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('-100000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTA',
        probableRecovery: true,
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(25_000);
    });

    it('allows DTA when probableRecovery is undefined (defaults to true)', () => {
      const r = ukDeferredTaxLine({
        entityId: 'e1',
        timingCategory: 'deductible_temporary',
        openingDTA: new Decimal(0),
        openingDTL: new Decimal(0),
        currentYearTemporaryChange: new Decimal('-50000'),
        taxRate: new Decimal('0.25'),
        dtType: 'DTA',
        jurisdiction: Jurisdiction.UK_FRS102_S29,
      });
      expect(r.deferredTaxAmount.toNumber()).toBe(12_500);
    });
  });

  describe('calculateUkDeferredTax (full)', () => {
    it('computes UK deferred tax with 25% rate', () => {
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

      const r = calculateUkDeferredTax(diffs, {}, {}, {
        deductible_temporary: new Decimal('0.25'),
        taxable_temporary: new Decimal('0.25'),
      });

      expect(r.totalClosingDTA.toNumber()).toBe(37_500);
      expect(r.totalClosingDTL.toNumber()).toBe(50_000);
      expect(r.netDeferredTaxExpense.toNumber()).toBe(12_500);
    });

    it('blocks DTA with probableRecoveryMap = false', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
          difference: new Decimal('-150000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateUkDeferredTax(diffs, {}, {}, {
        deductible_temporary: new Decimal('0.25'),
      }, { deductible_temporary: false });

      expect(r.totalClosingDTA.toNumber()).toBe(0);
      expect(r.lines[0].deferredTaxAmount.toNumber()).toBe(0);
    });

    it('uses UK default rate of 25% when taxRates is empty', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateUkDeferredTax(diffs, {}, {}, {});
      expect(r.totalClosingDTA.toNumber()).toBe(12_500);
    });
  });

  describe('US vs UK — deferred-tax.ts with jurisdiction', () => {
    it('US uses 21% default rate', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.US_ASC740);
      expect(r.totalClosingDTA.toNumber()).toBe(10_500);
    });

    it('UK uses 25% default rate via calculateDeferredTax', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29);
      expect(r.totalClosingDTA.toNumber()).toBe(12_500);
    });

    it('UK uses timing difference labels', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29);
      expect(r.lines[0].timingCategory).toBe('deductible_timing');
    });

    it('UK probable recovery map blocks DTA', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.UK_FRS102_S29, { deductible_temporary: false });
      expect(r.totalClosingDTA.toNumber()).toBe(0);
      expect(r.lines[0].deferredTaxAmount.toNumber()).toBe(0);
    });

    it('US ignores probable recovery map (always allows)', () => {
      const diffs: BookTaxDifference[] = [
        {
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('100000'), taxBalance: new Decimal('50000'),
          difference: new Decimal('-50000'), diffType: 'temporary',
          timingCategory: 'deductible_temporary',
        },
      ];

      const r = calculateDeferredTax(diffs, {}, {}, {}, Jurisdiction.US_ASC740, { deductible_temporary: false });
      expect(r.totalClosingDTA.toNumber()).toBe(10_500);
    });
  });
});
