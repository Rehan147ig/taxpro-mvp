import Decimal from 'decimal.js';
import type { CurrentTaxInput, CurrentTaxResult, USD, TaxRate } from '../types.js';
import { validateRate, validatePositive } from '../types.js';
import { calculateUkMarginalRelief } from './rules.js';

/**
 * UK FRS 102 current corporation tax.
 *
 * UK CT is not a flat rate: profits up to the small profits limit are taxed at
 * 19%, the full 25% rate applies above the upper limit, and marginal relief
 * applies in between (see calculateUkMarginalRelief). This module produces a
 * result shaped identically to the generic ASC 740 current tax so the rest of
 * the pipeline (ETR recon, journal entries, exports) is jurisdiction-agnostic,
 * plus an explicit `marginalRelief` figure for disclosure.
 */
export function calculateUkCurrentTax(input: CurrentTaxInput): CurrentTaxResult {
  validateRate('taxRate', input.taxRate);
  validatePositive('taxCredits', input.taxCredits);
  validatePositive('estimatedPayments', input.estimatedPayments);
  validatePositive('nolUtilization', input.nolUtilization);

  const totalPermanentAdjustments: USD = input.permanentDifferences.reduce(
    (sum, d) => sum.plus(d.amount), new Decimal(0),
  );

  const taxableIncome: USD = Decimal.max(0, input.bookIncome.plus(totalPermanentAdjustments));

  const { tax: federalTax, marginalRelief } = calculateUkMarginalRelief(taxableIncome);
  const stateTax: USD = new Decimal(0);

  const totalTaxBeforeCredits: USD = federalTax;
  const nolUtilization: USD = Decimal.min(input.nolUtilization, totalTaxBeforeCredits);
  const totalTaxAfterCredits: USD = Decimal.max(0, totalTaxBeforeCredits.minus(input.taxCredits).minus(nolUtilization));
  const taxPayable: USD = Decimal.max(0, totalTaxAfterCredits.minus(input.estimatedPayments));

  const effectiveTaxRate: TaxRate = input.bookIncome.greaterThan(0)
    ? totalTaxAfterCredits.div(input.bookIncome)
    : new Decimal(0);

  return {
    bookIncome: input.bookIncome,
    totalPermanentAdjustments,
    taxableIncome,
    federalTaxRate: input.taxRate,
    federalTax,
    stateTax,
    totalTaxBeforeCredits,
    taxCredits: input.taxCredits,
    nolUtilization,
    totalTaxAfterCredits,
    estimatedPayments: input.estimatedPayments,
    taxPayable,
    effectiveTaxRate,
    marginalRelief,
  };
}
