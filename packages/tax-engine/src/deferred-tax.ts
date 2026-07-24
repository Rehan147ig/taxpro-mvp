import Decimal from 'decimal.js';
import type {
  DeferredTaxInput, DeferredTaxResult, DeferredTaxLine, BookTaxDifference, USD, TaxRate,
} from './types.js';
import { validateRate, validatePositive } from './types.js';

/**
 * ASC 740-30: Calculate deferred tax expense/benefit.
 */
export function calculateDeferredTaxLine(input: DeferredTaxInput): DeferredTaxLine {
  validateRate('taxRate', input.taxRate);
  validatePositive('openingDTA', input.openingDTA);
  validatePositive('openingDTL', input.openingDTL);

  const deferredTaxAmount: USD = input.currentYearTemporaryChange.abs().mul(input.taxRate);

  const openingBalance: USD = input.dtType === 'DTA' ? input.openingDTA : input.openingDTL;
  const closingBalance: USD = openingBalance.plus(deferredTaxAmount);

  return {
    timingCategory: input.timingCategory,
    openingBalance,
    currentYearChange: input.currentYearTemporaryChange,
    taxRate: input.taxRate,
    deferredTaxAmount,
    reversals: new Decimal(0),
    closingBalance,
    dtType: input.dtType,
  };
}

/**
 * Given all book-tax temporary differences, compute the full deferred tax result.
 */
export function calculateDeferredTax(
  temporaryDifferences: BookTaxDifference[],
  priorYearDTAByCategory: Record<string, USD>,
  priorYearDTLByCategory: Record<string, USD>,
  taxRates: Record<string, TaxRate>,
): DeferredTaxResult {
  const lines: DeferredTaxLine[] = [];

  for (const diff of temporaryDifferences) {
    if (diff.diffType !== 'temporary') continue;

    const cat = diff.timingCategory ?? 'TEMP_OTHER';
    const isDeductible = cat === 'deductible_temporary';
    const dtType: 'DTA' | 'DTL' = isDeductible ? 'DTA' : 'DTL';

    const taxRate: TaxRate = taxRates[cat] ?? new Decimal('0.21');
    validateRate(`taxRates.${cat}`, taxRate);

    const opening: USD = isDeductible
      ? (priorYearDTAByCategory[cat] ?? new Decimal(0))
      : (priorYearDTLByCategory[cat] ?? new Decimal(0));

    const deferredTaxAmount: USD = diff.difference.abs().mul(taxRate);
    const closingBalance: USD = opening.plus(deferredTaxAmount);

    lines.push({
      timingCategory: cat,
      openingBalance: opening,
      currentYearChange: diff.difference,
      taxRate,
      deferredTaxAmount,
      reversals: new Decimal(0),
      closingBalance,
      dtType,
    });
  }

  const aggregated = aggregateByCategory(lines);

  const totalOpeningDTA: USD = aggregated
    .filter(l => l.dtType === 'DTA')
    .reduce((s, l) => s.plus(l.openingBalance), new Decimal(0));
  const totalOpeningDTL: USD = aggregated
    .filter(l => l.dtType === 'DTL')
    .reduce((s, l) => s.plus(l.openingBalance), new Decimal(0));
  const totalClosingDTA: USD = aggregated
    .filter(l => l.dtType === 'DTA')
    .reduce((s, l) => s.plus(l.closingBalance), new Decimal(0));
  const totalClosingDTL: USD = aggregated
    .filter(l => l.dtType === 'DTL')
    .reduce((s, l) => s.plus(l.closingBalance), new Decimal(0));

  const dtaChange: USD = totalClosingDTA.minus(totalOpeningDTA);
  const dtlChange: USD = totalClosingDTL.minus(totalOpeningDTL);
  const netDeferredTaxExpense: USD = dtlChange.minus(dtaChange);

  return {
    lines: aggregated,
    totalOpeningDTA,
    totalOpeningDTL,
    totalClosingDTA,
    totalClosingDTL,
    netDeferredTaxExpense,
  };
}

function aggregateByCategory(lines: DeferredTaxLine[]): DeferredTaxLine[] {
  const map = new Map<string, DeferredTaxLine>();

  for (const line of lines) {
    const key = `${line.timingCategory}::${line.dtType}`;
    const existing = map.get(key);
    if (existing) {
      existing.openingBalance = existing.openingBalance.plus(line.openingBalance);
      existing.currentYearChange = existing.currentYearChange.plus(line.currentYearChange);
      existing.deferredTaxAmount = existing.deferredTaxAmount.plus(line.deferredTaxAmount);
      existing.closingBalance = existing.closingBalance.plus(line.closingBalance);
    } else {
      map.set(key, { ...line });
    }
  }

  return Array.from(map.values());
}
