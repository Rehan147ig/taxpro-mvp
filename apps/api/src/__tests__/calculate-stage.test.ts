import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { createEngine, Jurisdiction } from '@taxpro/tax-engine';
import type { TrialBalanceLine, Account, TaxMapping, TaxAccountType } from '@taxpro/tax-engine';

/** Returns Profit Before Tax = ΣIncome - ΣExpense (positive = profit).
 *  Uses abs() so result is deterministic regardless of parser sign convention. */
function computeBookIncome(
  parsedItems: { accountType: string; balance: string }[],
): Decimal {
  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const p of parsedItems) {
    if (p.accountType === 'Income') income = income.plus(new Decimal(p.balance).abs());
    if (p.accountType === 'Expense') expense = expense.plus(new Decimal(p.balance).abs());
  }
  return income.minus(expense);
}

describe('calculate stage integration', () => {
  const engine = createEngine(Jurisdiction.US_ASC740);

  it('computeBookIncome returns Income - Expense (sign convention)', () => {
    const items = [
      { accountType: 'Income' as const, balance: '500000' },
      { accountType: 'Expense' as const, balance: '300000' },
    ];
    const result = computeBookIncome(items);
    expect(result.toNumber()).toBe(200000);
    expect(result.toNumber()).not.toBe(800000);
  });

  it('computeBookIncome handles mixed sign Expense balances (abs ensures determinism)', () => {
    const items = [
      { accountType: 'Income' as const, balance: '100000' },
      { accountType: 'Expense' as const, balance: '40000' },
      { accountType: 'Expense' as const, balance: '-10000' },
    ];
    const result = computeBookIncome(items);
    // Both +40000 and -10000 become abs(40000)=40000 + abs(-10000)=10000 = 50000 total expense
    // Income 100000 - Expense 50000 = 50000
    expect(result.toNumber()).toBe(50000);
  });

  it('computeBookIncome all income no expense returns full income', () => {
    const items = [
      { accountType: 'Income' as const, balance: '100000' },
    ];
    expect(computeBookIncome(items).toNumber()).toBe(100000);
  });

  it('computeBookIncome expense > income returns negative (loss)', () => {
    const items = [
      { accountType: 'Income' as const, balance: '50000' },
      { accountType: 'Expense' as const, balance: '80000' },
    ];
    expect(computeBookIncome(items).toNumber()).toBe(-30000);
  });

  it('computeBookIncome excludes Asset/Liability/Equity', () => {
    const items = [
      { accountType: 'Income' as const, balance: '500000' },
      { accountType: 'Expense' as const, balance: '300000' },
      { accountType: 'Asset' as const, balance: '999999' },
      { accountType: 'Liability' as const, balance: '999999' },
      { accountType: 'Equity' as const, balance: '999999' },
    ];
    const result = computeBookIncome(items);
    expect(result.toNumber()).toBe(200000);
  });

  it('computeBookTaxDifferences produces non-zero deferred tax with temporary differences', () => {
    const trialBalance: TrialBalanceLine[] = [
      { entityId: 'ent-1', accountId: 'PPE-001', period: '2026-01', balance: new Decimal('100000') },
      { entityId: 'ent-1', accountId: 'REV-001', period: '2026-01', balance: new Decimal('500000') },
      { entityId: 'ent-1', accountId: 'EXP-001', period: '2026-01', balance: new Decimal('300000') },
    ];

    const accounts: Account[] = [
      { id: 'PPE-001', accountNumber: 'PPE-001', name: 'Equipment', type: 'Asset' },
      { id: 'REV-001', accountNumber: 'REV-001', name: 'Revenue', type: 'Income' },
      { id: 'EXP-001', accountNumber: 'EXP-001', name: 'Salaries', type: 'Expense' },
    ];

    const taxMappings = new Map<string, TaxMapping>([
      ['PPE-001', {
        accountId: 'PPE-001', taxAccountType: 'TEMP_ACCELERATED_DEPRECIATION' as TaxAccountType,
        bookTreatment: 'temporary', timingCategory: 'taxable_temporary',
        confidenceScore: new Decimal('0.95'),
      }],
      ['REV-001', {
        accountId: 'REV-001', taxAccountType: 'NODIFF_REVENUE' as TaxAccountType,
        bookTreatment: 'no_diff',
        confidenceScore: new Decimal('0.95'),
      }],
      ['EXP-001', {
        accountId: 'EXP-001', taxAccountType: 'NODIFF_SALARIES' as TaxAccountType,
        bookTreatment: 'no_diff',
        confidenceScore: new Decimal('0.95'),
      }],
    ]);

    const diffs = engine.computeBookTaxDifferences(trialBalance, accounts, taxMappings, '2026-01');
    const tempDiffs = diffs.filter(d => d.diffType === 'temporary');

    expect(tempDiffs.length).toBe(1);
    expect(tempDiffs[0].accountId).toBe('PPE-001');
    expect(tempDiffs[0].difference.isZero()).toBe(false);
  });

  it('full calculation pipeline: book income → current tax → deferred tax → ETR', () => {
    const bookIncome = new Decimal('200000');
    const permanentDifferences: { amount: Decimal; label: string }[] = [
      { amount: new Decimal('-5000'), label: 'PERM_MEALS_ENTERTAINMENT' },
    ];
    const fiscalYear = '2026';
    const taxRate = engine.getRateForFiscalYear(fiscalYear);

    const currentTax = engine.calculateCurrentTax({
      bookIncome,
      permanentDifferences,
      taxRate,
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });

    expect(currentTax.bookIncome.toNumber()).toBe(200000);
    expect(currentTax.taxableIncome.toNumber()).toBe(195000);
    // ETR = (195000 * 0.21) / 200000 = 0.20475 — below statutory 21% due to permanent difference
    expect(currentTax.effectiveTaxRate.toNumber()).toBeCloseTo(0.20475, 4);

    const deferredTax = engine.calculateDeferredTax([], {}, {}, {}, undefined, '2026-01-01');
    expect(deferredTax.totalClosingDTA.toNumber()).toBe(0);
    expect(deferredTax.totalClosingDTL.toNumber()).toBe(0);

    const etr = engine.calculateETR({
      bookIncome: currentTax.bookIncome,
      federalTaxRate: currentTax.federalTaxRate,
      federalTax: currentTax.federalTax,
      stateTax: currentTax.stateTax,
      permanentDifferences,
      taxCredits: currentTax.taxCredits,
      otherAdjustments: [],
    });

    expect(etr.lines.length).toBeGreaterThanOrEqual(1);
    expect(etr.totalTaxExpense.isPositive()).toBe(true);
    expect(etr.effectiveTaxRate.toNumber()).toBeGreaterThan(0);
  });
});
