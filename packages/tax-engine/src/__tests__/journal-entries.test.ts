import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { generateJournalEntries } from '../journal-entries.js';
import type { CurrentTaxResult, DeferredTaxResult } from '../types.js';

function makeCurrentTax(overrides: Partial<CurrentTaxResult> = {}): CurrentTaxResult {
  return {
    bookIncome: new Decimal('1000000'),
    totalPermanentAdjustments: new Decimal(0),
    taxableIncome: new Decimal('1000000'),
    federalTaxRate: new Decimal('0.21'),
    federalTax: new Decimal('210000'),
    stateTax: new Decimal(0),
    totalTaxBeforeCredits: new Decimal('210000'),
    taxCredits: new Decimal(0),
    nolUtilization: new Decimal(0),
    totalTaxAfterCredits: new Decimal('210000'),
    estimatedPayments: new Decimal(0),
    taxPayable: new Decimal('210000'),
    effectiveTaxRate: new Decimal('0.21'),
    ...overrides,
  };
}

function makeDeferredTax(overrides: Partial<DeferredTaxResult> = {}): DeferredTaxResult {
  return {
    lines: [],
    totalOpeningDTA: new Decimal(0),
    totalOpeningDTL: new Decimal(0),
    totalClosingDTA: new Decimal(0),
    totalClosingDTL: new Decimal('50000'),
    netDeferredTaxExpense: new Decimal('50000'),
    ...overrides,
  };
}

describe('generateJournalEntries', () => {
  it('generates current tax entry when taxes are owed', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax(),
      new Decimal(0),
      'e1', '2026-01-01',
    );
    const currentEntry = entries.find(e => e.type === 'current_tax');
    expect(currentEntry).toBeDefined();
    expect(currentEntry!.lines[0].accountId).toBe('tax-expense-current');
    expect(currentEntry!.lines[1].accountId).toBe('tax-payable');
  });

  it('omits current tax entry when no tax is due', () => {
    const entries = generateJournalEntries(
      makeCurrentTax({ totalTaxAfterCredits: new Decimal(0), taxPayable: new Decimal(0) }),
      makeDeferredTax({ netDeferredTaxExpense: new Decimal(0) }),
      new Decimal(0),
      'e1', '2026-01-01',
    );
    expect(entries.length).toBe(0);
  });

  it('creates deferred tax entry for net DTL increase', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax({
        netDeferredTaxExpense: new Decimal('50000'),
        totalOpeningDTL: new Decimal(0),
        totalClosingDTL: new Decimal('50000'),
      }),
      new Decimal(0), 'e1', '2026-01-01',
    );
    const deferredEntry = entries.find(e => e.type === 'deferred_tax');
    expect(deferredEntry).toBeDefined();
    expect(deferredEntry!.lines.some(l => l.accountId === 'deferred-tax-liability')).toBe(true);
  });

  it('creates deferred tax entry for net DTA increase (benefit)', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax({
        netDeferredTaxExpense: new Decimal('-50000'),
        totalOpeningDTA: new Decimal(0),
        totalClosingDTA: new Decimal('50000'),
      }),
      new Decimal(0), 'e1', '2026-01-01',
    );
    const deferredEntry = entries.find(e => e.type === 'deferred_tax');
    expect(deferredEntry).toBeDefined();
    expect(deferredEntry!.lines.some(l => l.accountId === 'deferred-tax-asset')).toBe(true);
  });

  it('creates valuation allowance entry for increases', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax(),
      new Decimal('10000'), 'e1', '2026-01-01',
    );
    const vaEntry = entries.find(e => e.type === 'valuation_allowance');
    expect(vaEntry).toBeDefined();
    expect(vaEntry!.lines.some(l => l.accountId === 'valuation-allowance')).toBe(true);
  });

  it('creates valuation allowance entry for decreases (release)', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax(),
      new Decimal('-10000'), 'e1', '2026-01-01',
    );
    const vaEntry = entries.find(e => e.type === 'valuation_allowance');
    expect(vaEntry).toBeDefined();
    expect(vaEntry!.lines.some(l => l.accountId === 'valuation-allowance')).toBe(true);
  });

  it('skips valuation allowance when change is zero', () => {
    const entries = generateJournalEntries(
      makeCurrentTax({ totalTaxAfterCredits: new Decimal(0), taxPayable: new Decimal(0) }),
      makeDeferredTax({ netDeferredTaxExpense: new Decimal(0) }),
      new Decimal(0), 'e1', '2026-01-01',
    );
    expect(entries.some(e => e.type === 'valuation_allowance')).toBe(false);
  });

  it('debits equal credits for all entries', () => {
    const entries = generateJournalEntries(
      makeCurrentTax(),
      makeDeferredTax({ netDeferredTaxExpense: new Decimal('50000') }),
      new Decimal('10000'), 'e1', '2026-01-01',
    );
    for (const entry of entries) {
      expect(entry.totalDebit.toString()).toBe(entry.totalCredit.toString());
    }
  });
});
