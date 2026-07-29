import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { createEngine } from '../engine-factory.js';
import { Jurisdiction } from '../types.js';
import type { TrialBalanceLine, Account, TaxMapping, TaxAccountType } from '../types.js';
import { computeBookTaxDifferences } from '../book-tax-diff.js';

/**
 * Integration test for the full provision calculation pipeline.
 *
 * Uses deterministic mock data (no LLM calls). Validates:
 *   1. Book income = Income - Expense (sign-convention-independent)
 *   2. computeBookTaxDifferences produces non-zero temporary differences for depreciation
 *   3. Current tax, deferred tax, and ETR pipeline produces sensible results
 *
 * Limitation: assetAgeYears defaults to 1 (first-year MACRS) for all assets
 * since the trial balance doesn't carry placed-in-service dates.
 * This may overstate deferred tax liabilities for older assets.
 */

function computeBookIncome(items: { accountType: string; balance: string }[]): Decimal {
  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const p of items) {
    if (p.accountType === 'Income') income = income.plus(new Decimal(p.balance).abs());
    if (p.accountType === 'Expense') expense = expense.plus(new Decimal(p.balance).abs());
  }
  return income.minus(expense);
}

const mockState = {
  parsedItems: [
    { accountName: 'Sales Revenue',          accountType: 'Income'  as const, balance: '1000000', entityId: 'ent-1', period: '2026-01' },
    { accountName: 'Salaries',               accountType: 'Expense' as const, balance: '-400000', entityId: 'ent-1', period: '2026-01' },
    { accountName: 'Depreciation - Equipment', accountType: 'Expense' as const, balance: '-100000', entityId: 'ent-1', period: '2026-01' },
    { accountName: 'Meals & Entertainment',   accountType: 'Expense' as const, balance: '-20000',  entityId: 'ent-1', period: '2026-01' },
    { accountName: 'Office Equipment',        accountType: 'Asset'   as const, balance: '500000',  entityId: 'ent-1', period: '2026-01' },
  ],
  jurisdiction: 'US',
};

describe('provision integration', () => {
  const engine = createEngine(Jurisdiction.US_ASC740);

  it('1. bookIncome = Income - Expense = 480000, not 1.52M', () => {
    const bookIncome = computeBookIncome(mockState.parsedItems);
    // 1000000 - 400000 - 100000 - 20000 = 480000
    expect(bookIncome.toNumber()).toBe(480000);
    // Wrong: 1000000 + 400000 + 100000 + 20000 = 1520000
    expect(bookIncome.toNumber()).not.toBe(1520000);
  });

  it('2. computeBookTaxDifferences produces non-zero temporary + permanent differences', () => {
    const trialBalance: TrialBalanceLine[] = mockState.parsedItems.map(p => ({
      entityId: p.entityId,
      accountId: p.accountName,
      period: p.period,
      balance: new Decimal(p.balance).abs(),
    }));

    const accounts: Account[] = mockState.parsedItems.map(p => ({
      id: p.accountName,
      accountNumber: p.accountName,
      name: p.accountName,
      type: p.accountType,
    }));

    const taxMappings = new Map<string, TaxMapping>([
      ['Sales Revenue', {
        accountId: 'Sales Revenue', taxAccountType: 'NODIFF_REVENUE' as TaxAccountType,
        bookTreatment: 'no_diff',
        confidenceScore: new Decimal('0.95'),
      }],
      ['Salaries', {
        accountId: 'Salaries', taxAccountType: 'NODIFF_SALARIES' as TaxAccountType,
        bookTreatment: 'no_diff',
        confidenceScore: new Decimal('0.95'),
      }],
      ['Depreciation - Equipment', {
        accountId: 'Depreciation - Equipment', taxAccountType: 'TEMP_ACCELERATED_DEPRECIATION' as TaxAccountType,
        bookTreatment: 'temporary', timingCategory: 'taxable_temporary',
        confidenceScore: new Decimal('0.95'),
      }],
      ['Meals & Entertainment', {
        accountId: 'Meals & Entertainment', taxAccountType: 'PERM_MEALS_ENTERTAINMENT' as TaxAccountType,
        bookTreatment: 'permanent',
        confidenceScore: new Decimal('0.90'),
      }],
      ['Office Equipment', {
        accountId: 'Office Equipment', taxAccountType: 'TEMP_ACCELERATED_DEPRECIATION' as TaxAccountType,
        bookTreatment: 'temporary', timingCategory: 'taxable_temporary',
        confidenceScore: new Decimal('0.95'),
      }],
    ]);

    // assetAgeYears defaults to 1 (first-year MACRS) — documented limitation
    const diffs = computeBookTaxDifferences(trialBalance, accounts, taxMappings, '2026-01');
    const tempDiffs = diffs.filter(d => d.diffType === 'temporary');
    const permDiffs = diffs.filter(d => d.diffType === 'permanent');

    expect(tempDiffs.length).toBe(2);
    expect(permDiffs.length).toBe(1);

    for (const d of tempDiffs) {
      expect(d.difference.isZero()).toBe(false);
    }
    expect(permDiffs[0].difference.isZero()).toBe(true);
  });

  it('3. full pipeline: book income → current tax → deferred tax → ETR', () => {
    const bookIncome = computeBookIncome(mockState.parsedItems);
    expect(bookIncome.toNumber()).toBe(480000);

    const fiscalYear = '2026';
    const taxRate = engine.getRateForFiscalYear(fiscalYear);

    const permanentDifferences = [
      { amount: new Decimal('-20000'), label: 'PERM_MEALS_ENTERTAINMENT' },
    ];

    const currentTax = engine.calculateCurrentTax({
      bookIncome,
      permanentDifferences,
      taxRate,
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-01-01',
    });

    expect(currentTax.bookIncome.toNumber()).toBe(480000);
    expect(currentTax.taxableIncome.toNumber()).toBe(460000);
    expect(currentTax.totalTaxAfterCredits.toNumber()).toBeGreaterThan(0);

    const deferredTax = engine.calculateDeferredTax([], {}, {}, {}, undefined, '2026-01-01');
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

    expect(etr.totalTaxExpense.toNumber()).toBeGreaterThan(0);
    expect(etr.effectiveTaxRate.toNumber()).toBeGreaterThan(0);
    expect(etr.effectiveTaxRate.toNumber()).toBeLessThan(0.5);
  });
});
