import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeBookTaxDifferences } from '../book-tax-diff.js';
import type { TaxMapping, TrialBalanceLine, Account } from '../types.js';

describe('computeBookTaxDifferences', () => {
  const account: Account = { id: 'a1', accountNumber: '1000', name: 'Equipment', type: 'Asset' };
  const defaultMapping: TaxMapping = {
    accountId: 'a1', taxAccountType: 'TEMP_DEPRECIATION',
    bookTreatment: 'temporary', timingCategory: 'taxable_temporary',
    confidenceScore: new Decimal('0.7'),
  };

  it('no_diff returns zero difference', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', { ...defaultMapping, bookTreatment: 'no_diff' }]]),
      '2026-01-01',
    );
    expect(results[0].diffType).toBe('no_diff');
    expect(results[0].difference.toNumber()).toBe(0);
  });

  it('permanent difference returns zero difference', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', { ...defaultMapping, bookTreatment: 'permanent', taxAccountType: 'PERM_MEALS_ENTERTAINMENT' }]]),
      '2026-01-01',
    );
    expect(results[0].diffType).toBe('permanent');
    expect(results[0].difference.toNumber()).toBe(0);
  });

  it('temporary difference with MACRS year 1 factor', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', defaultMapping]]),
      '2026-01-01', 1,
    );
    // 5-year MACRS year 1 = 0.20 → difference = 100k * 0.20 = 20k
    expect(results[0].diffType).toBe('temporary');
    expect(results[0].difference.toNumber()).toBe(20_000);
  });

  it('deductible temporary difference has negative difference', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', { ...defaultMapping, timingCategory: 'deductible_temporary' }]]),
      '2026-01-01', 1,
    );
    expect(results[0].difference.isNegative()).toBe(true);
  });

  it('unmapped accounts default to no_diff', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map(),
      '2026-01-01',
    );
    expect(results[0].diffType).toBe('no_diff');
    expect(results[0].difference.toNumber()).toBe(0);
  });

  it('non-depreciation categories use default timing factors', () => {
    const mapping: TaxMapping = {
      accountId: 'a1', taxAccountType: 'TEMP_BAD_DEBT_RESERVE',
      bookTreatment: 'temporary', timingCategory: 'deductible_temporary',
      confidenceScore: new Decimal('0.75'),
    };
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', mapping]]),
      '2026-01-01', 1,
    );
    // Bad debt reserve = 0.15 factor → difference = 15k
    expect(results[0].difference.abs().toNumber()).toBe(15_000);
  });

  it('reversal period uses the provided asOfDate year', () => {
    const results = computeBookTaxDifferences(
      [{ entityId: 'e1', accountId: 'a1', period: '2026-01-01', balance: new Decimal('100000') }],
      [account],
      new Map([['a1', defaultMapping]]),
      '2025-06-15', 1,
    );
    // TEMP_DEPRECIATION reverses in 5 years → 2025 + 5 = 2030
    expect(results[0].reversalPeriod).toBe('2030');
  });

  it('empty trial balance returns empty array', () => {
    const results = computeBookTaxDifferences([], [account], new Map(), '2026-01-01');
    expect(results.length).toBe(0);
  });
});
