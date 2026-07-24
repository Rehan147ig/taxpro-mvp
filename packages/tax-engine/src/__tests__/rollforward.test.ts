import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { generateRollforward } from '../rollforward.js';
import type { RollforwardInput } from '../types.js';

describe('generateRollforward', () => {
  it('rolls forward deferred tax lines with no changes', () => {
    const input: RollforwardInput = {
      priorYear: {
        deferredTaxLines: [{
          timingCategory: 'TEMP_DEPRECIATION', openingBalance: new Decimal('100000'),
          currentYearChange: new Decimal(0), taxRate: new Decimal('0.21'),
          deferredTaxAmount: new Decimal(0), reversals: new Decimal(0),
          closingBalance: new Decimal('100000'), dtType: 'DTL',
        }],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [],
      },
    };

    const r = generateRollforward(input);
    expect(r.deferredTaxRollforward.length).toBe(1);
    expect(r.deferredTaxRollforward[0].closingBalance.toNumber()).toBe(100_000);
  });

  it('applies current year temporary differences', () => {
    const input: RollforwardInput = {
      priorYear: {
        deferredTaxLines: [{
          timingCategory: 'TEMP_DEPRECIATION', openingBalance: new Decimal('100000'),
          currentYearChange: new Decimal(0), taxRate: new Decimal('0.21'),
          deferredTaxAmount: new Decimal(0), reversals: new Decimal(0),
          closingBalance: new Decimal('100000'), dtType: 'DTL',
        }],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [{
          accountId: 'a1', entityId: 'e1', period: '2026-01-01',
          bookBalance: new Decimal('500000'), taxBalance: new Decimal('350000'),
          difference: new Decimal('-150000'), diffType: 'temporary',
          timingCategory: 'TEMP_DEPRECIATION',
        }],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [],
      },
    };

    const r = generateRollforward(input);
    expect(r.deferredTaxRollforward[0].closingBalance.toNumber()).toBe(131_500); // 100k + 150k*0.21
  });

  it('applies rate change adjustments', () => {
    const input: RollforwardInput = {
      priorYear: {
        deferredTaxLines: [{
          timingCategory: 'TEMP_DEPRECIATION', openingBalance: new Decimal('100000'),
          currentYearChange: new Decimal(0), taxRate: new Decimal('0.21'),
          deferredTaxAmount: new Decimal(0), reversals: new Decimal(0),
          closingBalance: new Decimal('100000'), dtType: 'DTL',
        }],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [{ category: 'TEMP_DEPRECIATION', oldRate: new Decimal('0.21'), newRate: new Decimal('0.25') }],
      },
    };

    const r = generateRollforward(input);
    // Rate adjustment: 100k * (0.25/0.21 - 1) = 100k * 0.190476... ≈ 19,047.62
    expect(r.deferredTaxRollforward[0].closingBalance.toNumber()).toBeCloseTo(119_047.62, -1);
  });

  it('throws on zero oldRate in rate change', () => {
    expect(() => generateRollforward({
      priorYear: {
        deferredTaxLines: [{
          timingCategory: 'TEMP_DEPRECIATION', openingBalance: new Decimal('100000'),
          currentYearChange: new Decimal(0), taxRate: new Decimal('0.21'),
          deferredTaxAmount: new Decimal(0), reversals: new Decimal(0),
          closingBalance: new Decimal('100000'), dtType: 'DTL',
        }],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [{ category: 'TEMP_DEPRECIATION', oldRate: new Decimal(0), newRate: new Decimal('0.25') }],
      },
    })).toThrow('oldRate cannot be zero');
  });

  it('NOL rollforward applies §382 limitation', () => {
    const r = generateRollforward({
      priorYear: {
        deferredTaxLines: [],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal('100000'),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal('50000'), nolGenerated: new Decimal('100000'),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [],
      },
    });
    // NOL generated capped at 80%: 100k * 0.8 = 80k
    // Closing: 100k + 80k - 50k = 130k
    expect(r.nolRollforward.opening.toNumber()).toBe(100_000);
    expect(r.nolRollforward.generated.toNumber()).toBe(80_000);
    expect(r.nolRollforward.closing.toNumber()).toBe(130_000);
  });

  it('credit rollforward closes at zero when fully utilized', () => {
    const r = generateRollforward({
      priorYear: {
        deferredTaxLines: [],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal('50000'),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal('60000'), creditsGenerated: new Decimal('20000'),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [],
      },
    });
    // Opening 50k + generated 20k - utilized 60k = 10k
    expect(r.creditRollforward.closing.toNumber()).toBe(10_000);
  });

  it('valuation allowance rolls forward correctly', () => {
    const r = generateRollforward({
      priorYear: {
        deferredTaxLines: [],
        valuationAllowance: new Decimal('50000'),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal(0), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal('10000'),
        taxRateChanges: [],
      },
    });
    expect(r.valuationAllowance.opening.toNumber()).toBe(50_000);
    expect(r.valuationAllowance.closing.toNumber()).toBe(60_000);
  });

  it('negative NOL utilization is rejected', () => {
    expect(() => generateRollforward({
      priorYear: {
        deferredTaxLines: [],
        valuationAllowance: new Decimal(0),
        nolCarryforward: new Decimal(0),
        taxCreditCarryforward: new Decimal(0),
      },
      currentYear: {
        temporaryDifferences: [],
        nolUtilized: new Decimal('-100'), nolGenerated: new Decimal(0),
        creditsUtilized: new Decimal(0), creditsGenerated: new Decimal(0),
        valuationAllowanceChange: new Decimal(0),
        taxRateChanges: [],
      },
    })).toThrow();
  });
});
