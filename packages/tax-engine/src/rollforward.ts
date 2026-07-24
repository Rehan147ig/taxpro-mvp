import Decimal from 'decimal.js';
import type { RollforwardInput, RollforwardResult, DeferredTaxLine, USD } from './types.js';
import { validatePositive } from './types.js';
import { NOL_SEC_382_LIMIT_FRACTION } from './constants.js';

/**
 * Generate the full deferred tax rollforward schedule.
 *
 * Deferred Tax Rollforward per category:
 *   Opening Balance
 *   + Current Year Change (addition/reversal)
 *   +/- Rate Change Adjustment
 *   = Closing Balance
 *
 * Also computes NOL (with §382 limitation) and Tax Credit rollforwards.
 */
export function generateRollforward(input: RollforwardInput): RollforwardResult {
  validatePositive('priorYear.nolCarryforward', input.priorYear.nolCarryforward);
  validatePositive('priorYear.valuationAllowance', input.priorYear.valuationAllowance);
  validatePositive('priorYear.taxCreditCarryforward', input.priorYear.taxCreditCarryforward);
  validatePositive('currentYear.nolGenerated', input.currentYear.nolGenerated);
  validatePositive('currentYear.nolUtilized', input.currentYear.nolUtilized);
  validatePositive('currentYear.creditsGenerated', input.currentYear.creditsGenerated);
  validatePositive('currentYear.creditsUtilized', input.currentYear.creditsUtilized);

  // ── Deferred Tax Rollforward ──
  const deferredTaxRollforward: DeferredTaxLine[] = input.priorYear.deferredTaxLines.map((prior) => {
    const currentDiff = input.currentYear.temporaryDifferences.find(
      (d) => d.timingCategory === prior.timingCategory,
    );
    const rateChange = input.currentYear.taxRateChanges.find(
      (r) => r.category === prior.timingCategory,
    );

    const currentYearChange: USD = currentDiff?.difference ?? new Decimal(0);
    const openingBalance: USD = prior.closingBalance;
    const deferredTaxAmount: USD = currentYearChange.abs().mul(prior.taxRate);

    let rateAdjustment: USD = new Decimal(0);
    if (rateChange) {
      if (rateChange.oldRate.isZero()) {
        throw new Error(
          `Rate change adjustment failed for ${prior.timingCategory}: oldRate cannot be zero.`,
        );
      }
      rateAdjustment = openingBalance.mul(rateChange.newRate.div(rateChange.oldRate).minus(1));
    }

    const closingBalance: USD = openingBalance.plus(deferredTaxAmount).plus(rateAdjustment);

    return {
      ...prior,
      openingBalance,
      currentYearChange,
      deferredTaxAmount,
      reversals: new Decimal(0),
      closingBalance,
    };
  });

  // ── NOL Rollforward with §382 limitation ──
  const nolGeneratedCapped: USD = input.currentYear.nolGenerated.mul(NOL_SEC_382_LIMIT_FRACTION);
  const nolClosing: USD = Decimal.max(0,
    input.priorYear.nolCarryforward.plus(nolGeneratedCapped).minus(input.currentYear.nolUtilized),
  );

  const nolRollforward = {
    opening: input.priorYear.nolCarryforward,
    generated: nolGeneratedCapped,
    utilized: input.currentYear.nolUtilized,
    closing: nolClosing,
  };

  // ── Tax Credit Rollforward ──
  const creditRollforward = {
    opening: input.priorYear.taxCreditCarryforward,
    generated: input.currentYear.creditsGenerated,
    utilized: input.currentYear.creditsUtilized,
    closing: Decimal.max(0,
      input.priorYear.taxCreditCarryforward
        .plus(input.currentYear.creditsGenerated)
        .minus(input.currentYear.creditsUtilized),
    ),
  };

  // ── Valuation Allowance Rollforward ──
  const valuationAllowance = {
    opening: input.priorYear.valuationAllowance,
    change: input.currentYear.valuationAllowanceChange,
    closing: input.priorYear.valuationAllowance.plus(input.currentYear.valuationAllowanceChange),
  };

  return {
    deferredTaxRollforward,
    nolRollforward,
    creditRollforward,
    valuationAllowance,
  };
}
