import Decimal from 'decimal.js';
import type { USD, TaxRate, Jurisdiction } from '../types.js';

// ── UK rate constants ──

export const UK_CORP_TAX_RATE: TaxRate = new Decimal('0.25');

export const UK_RATES_BY_FISCAL_YEAR: Record<string, TaxRate> = {
  '2023': new Decimal('0.25'),
  '2024': new Decimal('0.25'),
  '2025': new Decimal('0.25'),
  '2026': new Decimal('0.25'),
};

export const UK_SMALL_PROFITS_RATE: TaxRate = new Decimal('0.19');
export const UK_SMALL_PROFITS_THRESHOLD: USD = new Decimal('50000');
export const UK_MARGINAL_RELIEF_UPPER: USD = new Decimal('250000');
export const UK_MARGINAL_RELIEF_FRACTION: TaxRate = new Decimal('0.015'); // 3/200 per Finance Act 2023 (FY2023 onward)

export interface UkMarginalReliefConfig {
  mainRate: TaxRate;
  smallProfitsRate: TaxRate;
  lowerLimit: USD;
  upperLimit: USD;
  marginalReliefFraction: TaxRate;
}

export function getUkMarginalReliefConfig(): UkMarginalReliefConfig {
  return {
    mainRate: UK_CORP_TAX_RATE,
    smallProfitsRate: UK_SMALL_PROFITS_RATE,
    lowerLimit: UK_SMALL_PROFITS_THRESHOLD,
    upperLimit: UK_MARGINAL_RELIEF_UPPER,
    marginalReliefFraction: UK_MARGINAL_RELIEF_FRACTION,
  };
}

/**
 * Corporation tax with small profits rate and marginal relief (CTM 2023+).
 *
 *   Profits ≤ lower limit      →  small profits rate (19%)
 *   lower < profits < upper    →  main rate (25%) − MRF × (upper − profits)
 *   profits ≥ upper limit      →  main rate (25%)
 *
 * Limits are divided by the number of associated companies (s.18D CTA 2010).
 * Formula verified against HMRC published example: £125,000 profits → £29,375 CT.
 */
export function calculateUkMarginalRelief(
  profits: USD,
  associatedCompanies = 1,
): { tax: USD; marginalRelief: USD; effectiveRate: TaxRate } {
  if (!Number.isInteger(associatedCompanies) || associatedCompanies < 1) {
    throw new Error(`associatedCompanies must be a positive integer. Got: ${associatedCompanies}`);
  }
  const cfg = getUkMarginalReliefConfig();
  const lower = cfg.lowerLimit.div(associatedCompanies);
  const upper = cfg.upperLimit.div(associatedCompanies);

  const base: USD = profits.isNegative() ? new Decimal(0) : profits;

  let tax: USD;
  let marginalRelief: USD;

  if (base.lessThanOrEqualTo(lower)) {
    tax = base.mul(cfg.smallProfitsRate);
    marginalRelief = new Decimal(0);
  } else if (base.lessThan(upper)) {
    marginalRelief = upper.minus(base).mul(cfg.marginalReliefFraction);
    tax = base.mul(cfg.mainRate).minus(marginalRelief);
  } else {
    tax = base.mul(cfg.mainRate);
    marginalRelief = new Decimal(0);
  }

  const effectiveRate: TaxRate = profits.greaterThan(0)
    ? tax.div(profits)
    : new Decimal(0);

  return { tax, marginalRelief, effectiveRate };
}

// ── US rate constants ──

export const US_RATES_BY_FISCAL_YEAR: Record<string, TaxRate> = {
  '2023': new Decimal('0.21'),
  '2024': new Decimal('0.21'),
  '2025': new Decimal('0.21'),
  '2026': new Decimal('0.21'),
};

// ── Rate table lookup ──
// Falls back through: category-specific taxRates map → jurisdiction-year table → year default → hardcoded fallback

export function getRateForFiscalYear(
  jurisdiction: 'US_ASC740' | 'UK_FRS102_S29' | Jurisdiction,
  fiscalYear: string,
  categoryRates: Record<string, TaxRate>,
  yearTable: Record<string, TaxRate>,
  category?: string,
): TaxRate {
  if (category && categoryRates[category]) {
    return categoryRates[category];
  }
  if (yearTable[fiscalYear]) {
    return yearTable[fiscalYear];
  }
  // Fallback — should never happen for supported years
  return jurisdiction === 'UK_FRS102_S29' ? new Decimal('0.25') : new Decimal('0.21');
}

// ── Jurisdiction helpers ──

export function isUkJurisdiction(jurisdiction: Jurisdiction): boolean {
  return jurisdiction === 'UK_FRS102_S29';
}

/**
 * ETR recon adjustment for UK marginal relief. Marginal relief is a reduction
 * in tax liability, so it appears in the ETR reconciliation as a negative
 * tax-impact line (e.g. "25% statutory − marginal relief = effective rate").
 * Returns an empty array when no relief applies (non-UK or outside band).
 */
export function etrAdjustmentsForMarginalRelief(
  currentTax: { marginalRelief?: USD },
): { amount: USD; label: string }[] {
  if (!currentTax.marginalRelief || currentTax.marginalRelief.isZero()) return [];
  return [{ amount: currentTax.marginalRelief.negated(), label: 'Marginal relief (small profits rate)' }];
}

export function isRateWithinUkThreshold(profits: USD): boolean {
  return profits.lessThanOrEqualTo(UK_SMALL_PROFITS_THRESHOLD);
}

// ── Discounting rules ──
// FRS 102 Section 29.17 prohibits discounting of deferred tax.
// ASC 740 generally does not discount either, but other GAAPs may.

export function shouldDiscount(jurisdiction: Jurisdiction): boolean {
  if (isUkJurisdiction(jurisdiction)) return false; // FRS 102 29.17: no discounting
  return false; // default: no discounting (ASC 740 also does not discount)
}

// ── Probable recovery (UK-specific) ──
// FRS 102 29.14: DTA recognised only when recovery is probable.

export function checkProbableRecovery(
  jurisdiction: Jurisdiction,
  probableRecovery: boolean | undefined,
  dtType: 'DTA' | 'DTL',
): { allowed: boolean; reason?: string } {
  if (!isUkJurisdiction(jurisdiction)) {
    return { allowed: true };
  }
  if (dtType === 'DTL') {
    return { allowed: true };
  }
  if (probableRecovery === false) {
    return {
      allowed: false,
      reason: 'Deferred tax asset not recognised: probable recovery not assured per FRS 102 Section 29',
    };
  }
  return { allowed: true };
}

// ── Label helpers ──

export function applyTimingDifferenceLabel(category: string, jurisdiction: Jurisdiction): string {
  if (isUkJurisdiction(jurisdiction)) {
    return category.replace(/temporary/gi, 'timing');
  }
  return category;
}

// ── VAT filtering (UK-specific) ──

export function filterVat(turnover: USD, vatRate: TaxRate = new Decimal('0.20')): USD {
  const divisor = new Decimal(1).plus(vatRate);
  return turnover.div(divisor);
}

// ── Business combinations ──

export function calculateBusinessCombinationDt(
  acquireeTaxBase: USD,
  acquireeBookBase: USD,
  taxRate: TaxRate,
  goodwillAmount: USD,
): { deferredTax: USD; goodwillAdjustment: USD } {
  const difference = acquireeBookBase.minus(acquireeTaxBase);
  if (difference.isZero()) {
    return { deferredTax: new Decimal(0), goodwillAdjustment: new Decimal(0) };
  }
  const deferredTax = difference.abs().mul(taxRate);
  const goodwillAdjustment = deferredTax;
  return { deferredTax, goodwillAdjustment };
}

// ── Uncertain tax treatments ──

export function classifyUncertainTaxTreatment(
  amount: USD,
  probability: TaxRate,
  method: 'most-likely' | 'expected-value',
): USD {
  if (method === 'most-likely') {
    return probability.greaterThanOrEqualTo(new Decimal('0.50')) ? amount : new Decimal(0);
  }
  return amount.mul(probability);
}

// ── Disclosure format (UK FRS 102 29.26-29.29) ──

export const UK_DISCLOSURE_FORMAT = {
  deferredTaxAssets: 'debtors',
  deferredTaxLiabilities: 'provisions',
  valuationAllowance: 'not_permitted',
  netPresentation: 'not_permitted',
} as const;
