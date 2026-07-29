import Decimal from 'decimal.js';
import type { TaxMapping, BookTaxDifference, TrialBalanceLine, Account, USD } from './types.js';
import { MACRS_TABLES, MACRS_LIFE_MAP, DEFAULT_TIMING_FACTORS, REVERSAL_PERIOD_MAP } from './constants.js';

type DecimalInstance = InstanceType<typeof Decimal>;

/**
 * Compute book-tax differences from trial balance data + tax mappings.
 *
 * Uses MACRS tables for depreciation categories to compute accurate
 * timing factors based on asset age, rather than hardcoded percentages.
 *
 * Limitation: assetAgeYears defaults to 1 (first-year MACRS) for all assets.
 * This may overstate DTL for older assets. Future: parse placed-in-service
 * date from trial balance to compute real age.
 */
export function computeBookTaxDifferences(
  trialBalance: TrialBalanceLine[],
  accounts: Account[],
  mappings: Map<string, TaxMapping>,
  period: string,
  assetAgeYears: number = 1,
): BookTaxDifference[] {
  let warnedAge = false;
  const results: BookTaxDifference[] = [];

  for (const tb of trialBalance) {
    const mapping = mappings.get(tb.accountId);
    if (!mapping || mapping.bookTreatment === 'no_diff') {
      results.push({
        accountId: tb.accountId,
        entityId: tb.entityId,
        period: tb.period,
        bookBalance: tb.balance,
        taxBalance: tb.balance,
        difference: new Decimal(0),
        diffType: 'no_diff',
      });
      continue;
    }

    if (mapping.bookTreatment === 'permanent') {
      results.push({
        accountId: tb.accountId,
        entityId: tb.entityId,
        period: tb.period,
        bookBalance: tb.balance,
        taxBalance: tb.balance,
        difference: new Decimal(0),
        diffType: 'permanent',
      });
      continue;
    }

    // Temporary difference — use MACRS for depreciation, else fallback
    if (!warnedAge) {
      warnedAge = true;
      console.warn(
        `computeBookTaxDifferences: assetAgeYears=${assetAgeYears} for ${tb.accountId} — first-year MACRS assumed, `
        + `may overstate DTL for older assets. TODO: parse placed-in-service date from trial balance.`,
      );
    }
    const isDeductible = mapping.timingCategory === 'deductible_temporary';
    const timingFactor = getTimingFactor(mapping.taxAccountType, assetAgeYears);
    const difference: USD = tb.balance.mul(timingFactor).abs();
    const taxBalance: USD = isDeductible
      ? tb.balance.minus(difference)
      : tb.balance.plus(difference);

    results.push({
      accountId: tb.accountId,
      entityId: tb.entityId,
      period: tb.period,
      bookBalance: tb.balance,
      taxBalance,
      difference: isDeductible ? difference.negated() : difference,
      diffType: 'temporary',
      timingCategory: mapping.timingCategory,
      reversalPeriod: estimateReversalPeriod(mapping.taxAccountType, period),
    });
  }

  return results;
}

/**
 * Get timing factor using MACRS tables for depreciation categories,
 * falling back to default factors for non-depreciation temporary differences.
 *
 * @param type - Tax account type
 * @param assetAgeYears - How many years since the asset was placed in service (1-based)
 */
function getTimingFactor(type: string, assetAgeYears: number): DecimalInstance {
  // Check if this is a depreciation category with MACRS tables
  const life = MACRS_LIFE_MAP[type];
  if (life && MACRS_TABLES[life]) {
    const rates = MACRS_TABLES[life];
    const maxYear = Math.max(...Object.keys(rates).map(Number));
    if (assetAgeYears > maxYear) {
      return new Decimal('0');
    }
    return rates[assetAgeYears] ?? new Decimal('0');
  }

  return DEFAULT_TIMING_FACTORS[type] ?? new Decimal('0.10');
}

/**
 * Estimate reversal period based on MACRS life for depreciation or
 * default period for other categories.
 */
function estimateReversalPeriod(type: string, asOfDate: string): string {
  const years = REVERSAL_PERIOD_MAP[type] ?? 3;
  const asOfYear = new Date(asOfDate + 'T00:00:00.000Z').getFullYear();
  return String(asOfYear + years);
}
