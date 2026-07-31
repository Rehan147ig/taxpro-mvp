/**
 * XBRL ETR reconciliation → tax-engine input mapper.
 *
 * Disclosed recon items are dollar TAX IMPACTS (that's what the ASC 740
 * rate reconciliation table presents). The engine has three paths:
 *
 * - permanentDifferences: engine derives impact = amount × fedRate.
 *   We back out the implied book amount (impact / 0.21) for classic
 *   permanent items so this path gets exercised against real data.
 * - taxCredits: engine negates a positive input. Credits reduce ETR.
 * - otherAdjustments: amount flows through as the direct tax impact.
 *   State taxes go here because XBRL discloses them already net of
 *   federal benefit — feeding them to the engine's stateTax field
 *   would net them a second time.
 *
 * Sign convention quirk: XBRL defines recon items as "difference between
 * reported and expected tax" (so credits should be negative), but filers
 * are inconsistent. We resolve it empirically per filing: pick the sign
 * convention for credit-tagged items that makes the footnote tie to the
 * disclosed total, and report which one tied.
 */

import Decimal from 'decimal.js';
import { calculateETR, US_FEDERAL_CORP_RATE } from '@taxpro/tax-engine';
import type { ETRResult } from '@taxpro/tax-engine';
import type { ReconItem, TaxFootnote } from './ground-truth.js';

const FED = US_FEDERAL_CORP_RATE;

const CREDIT_TAGS = new Set([
  'IncomeTaxReconciliationTaxCredits',
  'IncomeTaxReconciliationTaxCreditsResearch',
  'IncomeTaxReconciliationTaxCreditsForeign',
  'IncomeTaxReconciliationTaxCreditsInvestment',
  'IncomeTaxReconciliationTaxCreditsOther',
  'IncomeTaxReconciliationGeneralBusinessTaxCredits',
  'IncomeTaxReconciliationEnergyTaxCredits',
  'IncomeTaxReconciliationLowIncomeHousingTaxCredits',
]);

const PERMANENT_TAGS = new Set([
  'IncomeTaxReconciliationNondeductibleExpense',
  'IncomeTaxReconciliationNondeductibleExpenseMealsAndEntertainment',
  'IncomeTaxReconciliationNondeductibleExpensePenaltiesAndFines',
  'IncomeTaxReconciliationNondeductibleExpenseShareBasedCompensationCost',
  'IncomeTaxReconciliationMealsAndEntertainment',
  'IncomeTaxReconciliationPenaltiesAndFines',
  'IncomeTaxReconciliationTaxExemptIncome',
  'IncomeTaxReconciliationTaxExemptIncomeInterest',
  'IncomeTaxReconciliationDividendsReceivedDeduction',
  'IncomeTaxReconciliationAmortizationOfGoodwillAndIntangibles',
]);

const STATE_TAGS = new Set([
  'IncomeTaxReconciliationStateAndLocalIncomeTaxes',
]);

const FOREIGN_TAGS = new Set([
  'IncomeTaxReconciliationForeignIncomeTaxRateDifferential',
  'IncomeTaxReconciliationForeignRateDifferential',
  'IncomeTaxReconciliationForeignIncomeTaxRateDifferentialByJurisdiction',
  'ForeignRateDifferential',
]);

const VALUATION_ALLOWANCE_TAGS = new Set([
  'IncomeTaxReconciliationValuationAllowance',
  'IncomeTaxReconciliationValuationAllowanceRelease',
  'IncomeTaxReconciliationChangeInValuationAllowance',
  'ChangeInValuationAllowance',
  'IncomeTaxReconciliationValuationAllowanceBenefit',
]);

const SBC_TAGS = new Set([
  'IncomeTaxReconciliationShareBasedCompensationExcessTaxBenefit',
  'IncomeTaxReconciliationShareBasedCompensationShortfall',
  'IncomeTaxReconciliationExcessTaxBenefitFromShareBasedCompensation',
  'IncomeTaxReconciliationShareBasedCompensationTaxBenefit',
]);

const CONTINGENCY_TAGS = new Set([
  'IncomeTaxReconciliationUncertainTaxPositions',
  'IncomeTaxReconciliationContingencies',
  'IncomeTaxReconciliationTaxContingencies',
  'IncomeTaxReconciliationReserveForUncertainTaxPositions',
]);

const PRIOR_YEAR_TAGS = new Set([
  'IncomeTaxReconciliationOtherReconcilingItemsPriorPeriod',
  'IncomeTaxReconciliationPriorYearAdjustments',
  'IncomeTaxReconciliationAdjustmentForPriorPeriod',
  'IncomeTaxReconciliationPriorPeriodAdjustments',
]);

export interface EngineRun {
  etr: ETRResult;
  classified: {
    permanent: ReconItem[];
    credits: ReconItem[];
    state: ReconItem[];
    foreignRateDifferential: ReconItem[];
    valuationAllowance: ReconItem[];
    shareBasedCompensation: ReconItem[];
    contingencies: ReconItem[];
    priorYearAdjustments: ReconItem[];
    other: ReconItem[];
  };
  creditSignFlipped: boolean;
  consistencyBp: number;
}

/** Normalize rate-based tags: strip "EffectiveIncomeTaxRateReconciliation" → "IncomeTaxReconciliation" suffix match. */
function suffixOf(tag: string): string {
  return tag
    .replace(/^EffectiveIncomeTaxRateReconciliation/, '')
    .replace(/^IncomeTaxReconciliation/, '');
}

const CREDIT_SUFFIXES = new Set([...CREDIT_TAGS].map(suffixOf));
const PERMANENT_SUFFIXES = new Set([...PERMANENT_TAGS].map(suffixOf));
const STATE_SUFFIXES = new Set([...STATE_TAGS].map(suffixOf));
const FOREIGN_SUFFIXES = new Set([...FOREIGN_TAGS].map(suffixOf));
const VALUATION_ALLOWANCE_SUFFIXES = new Set([...VALUATION_ALLOWANCE_TAGS].map(suffixOf));
const SBC_SUFFIXES = new Set([...SBC_TAGS].map(suffixOf));
const CONTINGENCY_SUFFIXES = new Set([...CONTINGENCY_TAGS].map(suffixOf));
const PRIOR_YEAR_SUFFIXES = new Set([...PRIOR_YEAR_TAGS].map(suffixOf));

function isCredit(tag: string) { return CREDIT_SUFFIXES.has(suffixOf(tag)); }
function isPermanent(tag: string) { return PERMANENT_SUFFIXES.has(suffixOf(tag)); }
function isState(tag: string) { return STATE_SUFFIXES.has(suffixOf(tag)); }
function isForeign(tag: string) { return FOREIGN_SUFFIXES.has(suffixOf(tag)); }
function isValuationAllowance(tag: string) { return VALUATION_ALLOWANCE_SUFFIXES.has(suffixOf(tag)); }
function isSbc(tag: string) { return SBC_SUFFIXES.has(suffixOf(tag)); }
function isContingency(tag: string) { return CONTINGENCY_SUFFIXES.has(suffixOf(tag)); }
function isPriorYear(tag: string) { return PRIOR_YEAR_SUFFIXES.has(suffixOf(tag)); }

function classify(items: ReconItem[]) {
  const classified = {
    permanent: [] as ReconItem[],
    credits: [] as ReconItem[],
    state: [] as ReconItem[],
    foreignRateDifferential: [] as ReconItem[],
    valuationAllowance: [] as ReconItem[],
    shareBasedCompensation: [] as ReconItem[],
    contingencies: [] as ReconItem[],
    priorYearAdjustments: [] as ReconItem[],
    other: [] as ReconItem[],
  };
  for (const item of items) {
    if (isCredit(item.tag)) classified.credits.push(item);
    else if (isPermanent(item.tag)) classified.permanent.push(item);
    else if (isState(item.tag)) classified.state.push(item);
    else if (isForeign(item.tag)) classified.foreignRateDifferential.push(item);
    else if (isValuationAllowance(item.tag)) classified.valuationAllowance.push(item);
    else if (isSbc(item.tag)) classified.shareBasedCompensation.push(item);
    else if (isContingency(item.tag)) classified.contingencies.push(item);
    else if (isPriorYear(item.tag)) classified.priorYearAdjustments.push(item);
    else classified.other.push(item);
  }
  return classified;
}

/** Internal consistency: statutory + Σitems vs disclosed total, in basis points of pretax. */
function consistencyBp(footnote: TaxFootnote, creditsFlipped: boolean): number {
  const statutory = footnote.statutoryLine ?? footnote.pretaxIncome * FED.toNumber();
  const sum = footnote.reconItems.reduce((s, item) => {
    const amount = CREDIT_TAGS.has(item.tag) && creditsFlipped ? -item.amount : item.amount;
    return s + amount;
  }, 0);
  return Math.abs(((statutory + sum - footnote.totalTaxExpense) / footnote.pretaxIncome) * 10_000);
}

export function runEngine(footnote: TaxFootnote): EngineRun {
  const classified = classify(footnote.reconItems);

  // Resolve credit sign convention: use whichever makes the footnote tie
  const asFiled = consistencyBp(footnote, false);
  const flipped = consistencyBp(footnote, true);
  const creditSignFlipped = classified.credits.length > 0 && flipped < asFiled;
  const bestConsistency = Math.min(asFiled, flipped);

  const permanentDifferences = classified.permanent.map(item => ({
    label: item.label,
    amount: new Decimal(item.amount).div(FED), // back out book amount; engine re-derives the impact
  }));

  const taxCredits = classified.credits
    .reduce((sum, item) => {
      // Convention: credits reduce tax. Normalized = absolute value (engine negates it).
      // If the filer already filed them negative, |x| is still correct after sign resolution.
      return sum.plus(new Decimal(item.amount).abs());
    }, new Decimal(0));

  const otherAdjustments = [
    ...classified.state,
    ...classified.foreignRateDifferential,
    ...classified.valuationAllowance,
    ...classified.shareBasedCompensation,
    ...classified.contingencies,
    ...classified.priorYearAdjustments,
    ...classified.other,
  ].map(item => ({
    label: STATE_TAGS.has(item.tag) ? `${item.label} (as disclosed, net of federal)` : item.label,
    amount: new Decimal(item.amount),
  }));

  const bookIncome = new Decimal(footnote.pretaxIncome);
  const federalTax = bookIncome.mul(FED);

  const etr = calculateETR({
    bookIncome,
    federalTaxRate: FED,
    federalTax,
    stateTax: new Decimal(0),
    permanentDifferences,
    taxCredits,
    otherAdjustments,
  });

  return { etr, classified, creditSignFlipped, consistencyBp: bestConsistency };
}
