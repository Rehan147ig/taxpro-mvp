import Decimal from 'decimal.js';
import type { TaxMapping, BookTaxDifference, TrialBalanceLine, Account, USD } from './types.js';
import { MACRS_TABLES, MACRS_LIFE_MAP, DEFAULT_TIMING_FACTORS, REVERSAL_PERIOD_MAP } from './constants.js';

type DecimalInstance = InstanceType<typeof Decimal>;

export type DepreciationAgeSource = 'placed_in_service' | 'explicit_age' | 'assumed_first_year' | 'no_metadata';

/**
 * Compute book-tax differences from trial balance data + tax mappings.
 *
 * Uses MACRS tables for depreciation categories to compute accurate
 * timing factors based on asset age, rather than hardcoded percentages.
 *
 * Asset age resolution precedence (per account):
 *   1. `placedInServiceDate` on the trial balance line
 *   2. `assetAgeYears` on the trial balance line
 *   3. `placedInServiceDate` on the account
 *   4. `assumedAssetAgeYears` fallback (default 1 = first-year MACRS)
 *
 * When no metadata is available for a MACRS depreciation category, the
 * difference is still computed with the fallback age so deterministic math
 * never blocks, but the result carries `depreciationAgeSource: 'no_metadata'`
 * so callers can raise a review item + low confidence instead of silently
 * assuming first-year treatment.
 */
export function computeBookTaxDifferences(
  trialBalance: TrialBalanceLine[],
  accounts: Account[],
  mappings: Map<string, TaxMapping>,
  period: string,
  assumedAssetAgeYears: number = 1,
): BookTaxDifference[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
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

    const isDeductible = mapping.timingCategory === 'deductible_temporary';
    const { ageYears, ageSource } = resolveAssetAge(tb, accountById.get(tb.accountId), period, assumedAssetAgeYears, mapping.taxAccountType);
    const timingFactor = getTimingFactor(mapping.taxAccountType, ageYears);
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
      depreciationAgeSource: ageSource,
      assetAgeYears: ageYears,
    });
  }

  return results;
}

/**
 * Resolve the MACRS asset age for a single trial balance line.
 *
 * Only MACRS depreciation categories (present in MACRS_LIFE_MAP) require
 * metadata; everything else resolves to the assumed age with source
 * 'assumed_first_year' and never triggers a review item.
 */
function resolveAssetAge(
  tb: TrialBalanceLine,
  account: Account | undefined,
  period: string,
  assumedAssetAgeYears: number,
  taxAccountType: string,
): { ageYears: number; ageSource: DepreciationAgeSource } {
  const isMacrs = Boolean(MACRS_LIFE_MAP[taxAccountType]);

  if (isMacrs && tb.placedInServiceDate) {
    const age = yearsSince(tb.placedInServiceDate, period);
    return { ageYears: Math.max(1, age), ageSource: 'placed_in_service' };
  }

  if (isMacrs && typeof tb.assetAgeYears === 'number') {
    return { ageYears: Math.max(1, tb.assetAgeYears), ageSource: 'explicit_age' };
  }

  if (isMacrs && account?.placedInServiceDate) {
    const age = yearsSince(account.placedInServiceDate, period);
    return { ageYears: Math.max(1, age), ageSource: 'placed_in_service' };
  }

  if (isMacrs) {
    return { ageYears: Math.max(1, assumedAssetAgeYears), ageSource: 'no_metadata' };
  }

  return { ageYears: Math.max(1, assumedAssetAgeYears), ageSource: 'assumed_first_year' };
}

/** Calendar-year age in service (e.g. placed 2022-07, period 2026-01 -> 4). */
function yearsSince(placedInServiceDate: string, period: string): number {
  const placedYear = new Date(placedInServiceDate + 'T00:00:00.000Z').getFullYear();
  const periodYear = new Date(period + 'T00:00:00.000Z').getFullYear();
  if (Number.isNaN(placedYear) || Number.isNaN(periodYear)) return 1;
  return periodYear - placedYear + 1;
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
