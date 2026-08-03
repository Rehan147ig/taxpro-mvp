// ── US Quarterly Interim Provision — ASC 740-270 mechanics ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// This module computes the ARITHMETIC of the estimated annual effective tax
// rate (AETR) method for interim periods (ASC 740-270-30-6..10):
//   - The tax year's estimated ordinary income is used to estimate the
//     annual ordinary tax.
//   - The estimated AETR = estimated annual tax / estimated annual ordinary
//     income (the "ordinary income" method), or the annualized-income
//     variant (ASC 740-270-30-8 as commonly referenced) when year-to-date
//     results are the best estimate.
//   - Interim expense = YTD ordinary income × AETR, less tax recognized in
//     prior quarters, adjusted for discrete items (ASC 740-270-30-21..23 as
//     commonly referenced) recognized in the quarter they occur.
//
// It does NOT determine the AETR — that is the preparer's estimate. This
// module only allocates the estimate across quarters and verifies the
// roll-forward ties. No estimate of future tax law changes is modeled.
//
// General (guessed) assumptions, all UNVALIDATED:
//   - Annualized variant: YTD income is annualized pro-rata (YTD / fraction
//     of year elapsed, e.g. Q1 = 3/12) when `annualizedFraction` is omitted.
//   - Ordinary income excludes discrete items; discrete items are excluded
//     from the AETR and recognized in the quarter incurred.
//   - The AETR method applies to year-to-date ordinary income before
//     credits; credits and other discrete items are folded into the
//     quarter's expense via the discrete adjustment term.
//   - No rate changes within the year are modeled (a schedule of quarterly
//     effective rates would be needed).

import { Decimal } from 'decimal.js';

export interface InterimQuarterInput {
  /** Quarter number 1..4 (or 1..n for an n-quarter year). */
  quarter: number;
  /** Year-to-date ordinary income through the end of this quarter. */
  ytdOrdinaryIncome: Decimal.Value;
  /**
   * Year-to-date discrete items (net of tax), e.g. settlements, carryback
   * claims. Positive = expense.
   */
  ytdDiscreteItems?: Decimal.Value;
  /** Tax recognized in prior quarters of the year (carried through). */
  taxRecognizedPriorQuarters: Decimal.Value;
}

export interface QuarterlyProvisionInput {
  quarters: InterimQuarterInput[];
  /**
   * Estimated annual ordinary income used to derive the AETR. When omitted,
   * the annualized-income method is used: the latest YTD ordinary income is
   * annualized via `annualizedFraction`.
   */
  estimatedAnnualOrdinaryIncome?: Decimal.Value;
  /**
   * Estimated annual ordinary tax (tax at estimated annual ordinary income
   * before credits and discrete items).
   */
  estimatedAnnualOrdinaryTax: Decimal.Value;
  /** Fraction of the year elapsed as of the last provided quarter (default 3/12 for Q1-style inputs). */
  annualizedFraction?: Decimal.Value;
  /** Number of quarters in the year (default 4). */
  quartersInYear?: number;
}

export interface InterimQuarterResult {
  quarter: number;
  aetr: Decimal;
  ytdOrdinaryIncome: Decimal;
  ytdTaxAtAetr: Decimal;
  ytdDiscreteItems: Decimal;
  taxRecognizedPriorQuarters: Decimal;
  discreteAdjustmentCurrentQuarter: Decimal;
  quarterTaxExpense: Decimal;
}

export interface QuarterlyProvisionResult {
  annualizedIncomeUsed: boolean;
  aetr: Decimal;
  quarters: InterimQuarterResult[];
  totalYearToDateTax: Decimal;
  priorQuartersTotal: Decimal;
  consistency: { ok: boolean; issues: string[] };
}

function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/**
 * Allocates the estimated annual effective tax rate across interim quarters
 * (ASC 740-270 mechanics). Pure and deterministic. Never throws for numeric
 * inputs; degenerate inputs (zero/negative annual income) degrade to a
 * year-to-date tax of zero with an explanatory issue.
 */
export function calculateInterimProvision(input: QuarterlyProvisionInput): QuarterlyProvisionResult {
  const quartersInYear = input.quartersInYear ?? 4;
  const issues: string[] = [];

  const lastQuarter = [...input.quarters].sort((a, b) => b.quarter - a.quarter)[0];
  let annualizedIncome: Decimal | null = null;
  let annualOrdinaryIncome: Decimal | null = null;

  if (input.estimatedAnnualOrdinaryIncome !== undefined) {
    annualOrdinaryIncome = d(input.estimatedAnnualOrdinaryIncome);
  } else if (lastQuarter) {
    const fraction = input.annualizedFraction !== undefined
      ? d(input.annualizedFraction)
      : new Decimal(lastQuarter.quarter).div(quartersInYear);
    if (fraction.isZero()) {
      issues.push('annualized fraction is zero — annualization impossible; treating AETR as zero');
    } else {
      annualizedIncome = d(lastQuarter.ytdOrdinaryIncome).div(fraction);
      annualOrdinaryIncome = annualizedIncome;
    }
  }

  const annualTax = d(input.estimatedAnnualOrdinaryTax).isNegative() ? new Decimal(0) : d(input.estimatedAnnualOrdinaryTax);
  if (d(input.estimatedAnnualOrdinaryTax).isNegative()) {
    issues.push('estimated annual ordinary tax is negative — clamped to zero');
  }
  let aetr = new Decimal(0);
  if (annualOrdinaryIncome !== null && !annualOrdinaryIncome.isZero() && !annualOrdinaryIncome.isNegative()) {
    aetr = annualTax.div(annualOrdinaryIncome);
  } else if (annualOrdinaryIncome !== null && annualOrdinaryIncome.isNegative()) {
    issues.push('estimated annual ordinary income is negative — loss year; AETR set to zero, interim expense driven by discrete items only');
  } else {
    issues.push('no annual income estimate available — AETR set to zero');
  }

  let priorTotal = new Decimal(0);
  const quarters: InterimQuarterResult[] = [...input.quarters]
    .sort((a, b) => a.quarter - b.quarter)
    .map((q, index) => {
      const ytdOrdinary = d(q.ytdOrdinaryIncome);
      const ytdDiscrete = q.ytdDiscreteItems !== undefined ? d(q.ytdDiscreteItems) : new Decimal(0);
      const ytdTax = ytdOrdinary.times(aetr);
      // Discrete items are excluded from the AETR and recognized in the
      // quarter they occur (ASC 740-270-30-21 as commonly referenced). The
      // current-quarter discrete adjustment is YTD discrete minus what was
      // already recognized in prior quarters.
      const discreteCurrent = ytdDiscrete.minus(priorDiscrete(input.quarters, q.quarter));
      const quarterTax = ytdTax
        .plus(discreteCurrent)
        .minus(d(q.taxRecognizedPriorQuarters));
      priorTotal = priorTotal.plus(quarterTax);
      return {
        quarter: q.quarter,
        aetr,
        ytdOrdinaryIncome: ytdOrdinary,
        ytdTaxAtAetr: ytdTax,
        ytdDiscreteItems: ytdDiscrete,
        taxRecognizedPriorQuarters: d(q.taxRecognizedPriorQuarters),
        discreteAdjustmentCurrentQuarter: discreteCurrent,
        quarterTaxExpense: quarterTax,
      };
    });

  const totalYtd = quarters.reduce((sum, q) => sum.plus(q.quarterTaxExpense), new Decimal(0));
  const priorDeclared = quarters.reduce((sum, q) => sum.plus(q.taxRecognizedPriorQuarters), new Decimal(0));

  if (totalYtd.minus(priorTotal).abs().greaterThan('1e-9')) {
    issues.push('year-to-date total does not equal the sum of quarterly expense — roll-forward does not tie');
  }
  if (input.quarters.some(q => q.quarter < 1)) {
    issues.push('quarter numbers must be >= 1');
  }

  return {
    annualizedIncomeUsed: annualizedIncome !== null,
    aetr,
    quarters,
    totalYearToDateTax: totalYtd,
    priorQuartersTotal: priorDeclared,
    consistency: { ok: issues.length === 0, issues },
  };
}

function priorDiscrete(quarters: InterimQuarterInput[], upToQuarter: number): Decimal {
  let sum = new Decimal(0);
  for (const q of quarters) {
    if (q.quarter >= upToQuarter) continue;
    sum = sum.plus(q.ytdDiscreteItems !== undefined ? d(q.ytdDiscreteItems) : new Decimal(0));
  }
  return sum;
}
