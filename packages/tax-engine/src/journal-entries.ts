import Decimal from 'decimal.js';
import type {
  CurrentTaxResult, DeferredTaxResult, JournalEntry, JournalEntryLine, USD,
} from './types.js';

/**
 * Generate proposed journal entries from tax provision results.
 */
export function generateJournalEntries(
  currentTax: CurrentTaxResult,
  deferredTax: DeferredTaxResult,
  valuationAllowanceChange: USD,
  entityId: string,
  period: string,
): JournalEntry[] {
  const entries: JournalEntry[] = [];

  // ── 1. Current Tax Entry ──
  if (currentTax.totalTaxAfterCredits.greaterThan(0)) {
    const currentTaxLines: JournalEntryLine[] = [
      {
        accountId: 'tax-expense-current',
        debit: currentTax.totalTaxAfterCredits,
        credit: new Decimal(0),
        memo: `Current tax expense for ${period}`,
      },
      {
        accountId: 'tax-payable',
        debit: new Decimal(0),
        credit: currentTax.totalTaxAfterCredits,
        memo: `Current tax payable for ${period}`,
      },
    ];

    entries.push({
      type: 'current_tax',
      entityId,
      period,
      lines: currentTaxLines,
      totalDebit: currentTax.totalTaxAfterCredits,
      totalCredit: currentTax.totalTaxAfterCredits,
    });
  }

  // ── 2. Deferred Tax Entry ──
  const netDeferred: USD = deferredTax.netDeferredTaxExpense;

  if (!netDeferred.isZero()) {
    const deferredLines: JournalEntryLine[] = [];

    if (netDeferred.greaterThan(0)) {
      deferredLines.push({
        accountId: 'tax-expense-deferred',
        debit: netDeferred,
        credit: new Decimal(0),
        memo: `Deferred tax expense for ${period}`,
      });
      if (deferredTax.totalClosingDTL.greaterThan(deferredTax.totalOpeningDTL)) {
        deferredLines.push({
          accountId: 'deferred-tax-liability',
          debit: new Decimal(0),
          credit: netDeferred,
          memo: `Increase in DTL for ${period}`,
        });
      }
    } else {
      const benefit: USD = netDeferred.abs();
      deferredLines.push({
        accountId: 'tax-expense-deferred',
        debit: new Decimal(0),
        credit: benefit,
        memo: `Deferred tax benefit for ${period}`,
      });
      if (deferredTax.totalClosingDTA.greaterThan(deferredTax.totalOpeningDTA)) {
        deferredLines.push({
          accountId: 'deferred-tax-asset',
          debit: benefit,
          credit: new Decimal(0),
          memo: `Increase in DTA for ${period}`,
        });
      }
    }

    const total: USD = netDeferred.abs();
    entries.push({
      type: 'deferred_tax',
      entityId,
      period,
      lines: deferredLines,
      totalDebit: deferredLines.reduce((s, l) => s.plus(l.debit), new Decimal(0)),
      totalCredit: deferredLines.reduce((s, l) => s.plus(l.credit), new Decimal(0)),
    });
  }

  // ── 3. Valuation Allowance Entry ──
  if (!valuationAllowanceChange.isZero()) {
    const vaLines: JournalEntryLine[] = [];

    if (valuationAllowanceChange.greaterThan(0)) {
      vaLines.push({
        accountId: 'tax-expense-deferred',
        debit: valuationAllowanceChange,
        credit: new Decimal(0),
        memo: `Valuation allowance increase for ${period}`,
      });
      vaLines.push({
        accountId: 'valuation-allowance',
        debit: new Decimal(0),
        credit: valuationAllowanceChange,
        memo: `Valuation allowance for ${period}`,
      });
    } else {
      const decrease: USD = valuationAllowanceChange.abs();
      vaLines.push({
        accountId: 'valuation-allowance',
        debit: decrease,
        credit: new Decimal(0),
        memo: `Valuation allowance decrease for ${period}`,
      });
      vaLines.push({
        accountId: 'tax-expense-deferred',
        debit: new Decimal(0),
        credit: decrease,
        memo: `Valuation allowance release for ${period}`,
      });
    }

    entries.push({
      type: 'valuation_allowance',
      entityId,
      period,
      lines: vaLines,
      totalDebit: vaLines.reduce((s, l) => s.plus(l.debit), new Decimal(0)),
      totalCredit: vaLines.reduce((s, l) => s.plus(l.credit), new Decimal(0)),
    });
  }

  return entries;
}
