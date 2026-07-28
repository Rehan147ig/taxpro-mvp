import Decimal from 'decimal.js';
import type { USD, TaxRate, Jurisdiction } from '../types.js';

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

export function isUkJurisdiction(jurisdiction: Jurisdiction): boolean {
  return jurisdiction === 'UK_FRS102_S29';
}

export function isRateWithinUkThreshold(profits: USD): boolean {
  return profits.lessThanOrEqualTo(UK_SMALL_PROFITS_THRESHOLD);
}

export function shouldDiscount(jurisdiction: Jurisdiction): boolean {
  if (isUkJurisdiction(jurisdiction)) return false;
  return true;
}

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

export function applyTimingDifferenceLabel(category: string, jurisdiction: Jurisdiction): string {
  if (isUkJurisdiction(jurisdiction)) {
    return category.replace(/temporary/gi, 'timing');
  }
  return category;
}

export function filterVat(turnover: USD, vatRate: TaxRate = new Decimal('0.20')): USD {
  const divisor = new Decimal(1).plus(vatRate);
  return turnover.div(divisor);
}

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

export const UK_DISCLOSURE_FORMAT = {
  deferredTaxAssets: 'debtors',
  deferredTaxLiabilities: 'provisions',
  valuationAllowance: 'not_permitted',
  netPresentation: 'not_permitted',
} as const;
