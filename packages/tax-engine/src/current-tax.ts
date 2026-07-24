import Decimal from 'decimal.js';
import type { CurrentTaxInput, CurrentTaxResult, USD, TaxRate } from './types.js';
import { validateRate, validatePositive } from './types.js';
import { US_FEDERAL_CORP_RATE, DEFAULT_STATE_APPORTIONMENT } from './constants.js';

/**
 * ASC 740-10: Calculate current tax expense.
 *
 * Formula: (Book Income ± Permanent Differences) × Tax Rate − Credits − NOL = Current Tax
 */
export function calculateCurrentTax(input: CurrentTaxInput): CurrentTaxResult {
  validateRate('taxRate', input.taxRate);
  validatePositive('taxCredits', input.taxCredits);
  validatePositive('estimatedPayments', input.estimatedPayments);
  validatePositive('nolUtilization', input.nolUtilization);

  if (input.stateTaxRate) validateRate('stateTaxRate', input.stateTaxRate);

  const totalPermanentAdjustments: USD = input.permanentDifferences.reduce(
    (sum, d) => sum.plus(d.amount), new Decimal(0),
  );

  const taxableIncome: USD = Decimal.max(0, input.bookIncome.plus(totalPermanentAdjustments));

  const federalTax: USD = taxableIncome.mul(input.taxRate);
  const stateTax: USD = input.stateTaxRate
    ? taxableIncome.mul(DEFAULT_STATE_APPORTIONMENT).mul(input.stateTaxRate)
    : new Decimal(0);

  const totalTaxBeforeCredits: USD = federalTax.plus(stateTax);
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
  };
}
