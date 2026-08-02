// ── US Multi-State Apportionment — SKELETON only ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// This file is an EXPLORATORY SKELETON. It computes the arithmetic of the
// apportionment formula (payroll / property / sales factors combined by
// weighted fraction) but it does NOT implement any state's law:
//   - No state tax rates are hardcoded anywhere (rates belong to the caller).
//   - No state-specific factor treatments are applied.
//   - Where a state rule is known to diverge, a TODO marker is left citing the
//     state statute that must be read before the code can be trusted.
//
// General (guessed) assumptions, all UNVALIDATED:
//   - Sales factor is destination-based (receipts sourced to the state of
//     destination). Throwback of sales to the state of origin when the
//     destination state cannot tax is NOT implemented.
//   - Property factor uses a single end-of-period value. Many states use the
//     average of beginning and end of year — that refinement is a TODO.
//   - Factors are expressed as fractions (0..1) of a company-wide total; the
//     total used is whatever the caller supplies (state-wide vs US-wide
//     totals differ by state — caller must supply the right totals).
//   - Default weightings are one third per factor. Several states now use a
//     single sales factor; the caller can pass explicit weights.

import { Decimal } from 'decimal.js';

export interface StateFactorsInput {
  /** Two-letter state code, e.g. 'CA'. */
  stateCode: string;
  /** Amounts are Decimal.Value (string, number or Decimal). */
  payrollInState: Decimal.Value;
  payrollTotal: Decimal.Value;
  propertyInState: Decimal.Value;
  propertyTotal: Decimal.Value;
  salesInState: Decimal.Value;
  salesTotal: Decimal.Value;
  /** Optional explicit weights; default one third each. */
  weightPayroll?: Decimal.Value;
  weightProperty?: Decimal.Value;
  weightSales?: Decimal.Value;
}

export type StateFactorStatus =
  | 'ok'
  | 'no_activity'
  | 'invalid_totals'
  | 'invalid_factors'
  | 'invalid_weights';

export interface StateApportionmentResult {
  stateCode: string;
  status: StateFactorStatus;
  /** Human-readable reason when status !== 'ok'. */
  reason: string;
  /** Each factor is in [0,1]; null when the factor could not be computed. */
  payrollFactor: Decimal | null;
  propertyFactor: Decimal | null;
  salesFactor: Decimal | null;
  /**
   * Weighted apportionment fraction = sum(weight_i * factor_i).
   * Null unless every required factor was computed and weights are valid.
   */
  apportionmentFraction: Decimal | null;
}

const THIRD = new Decimal(1).div(3);
const WEIGHT_TOLERANCE = new Decimal('1e-9');

/**
 * TODO markers for state-law work that must happen before this skeleton can be
 * trusted. These are POINTERS, not assertions of current law. Read the cited
 * statute text before implementing anything.
 */
export const STATE_LAW_TODOS: readonly string[] = [
  'TODO: California — single sales factor for most apportioning taxpayers (see Cal. Rev. & Tax Code §25128.7 as commonly referenced; verify current statute text and effective dates).',
  'TODO: New York — business allocation percentage with a sales factor that has displaced most of the property/payroll weighting (see NY Tax Law §210-A as commonly referenced; verify current text).',
  'TODO: Texas — franchise tax is margin-based with no income apportionment formula of this shape (see Tex. Tax Code Ch. 171 as commonly referenced; verify whether this calculator should even be invoked).',
  'TODO: sales factor throwback rules — states re-source receipts to origin when destination state lacks nexus; not implemented anywhere in this package.',
  'TODO: property averaging — several states average beginning/end-of-year property; this skeleton uses a single end-of-period value.',
  'TODO: combined/unitary reporting — multi-state groups often apportion on a combined basis; this skeleton is per-entity only.',
] as const;

function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

function factorFor(numerator: Decimal.Value, denominator: Decimal.Value): { factor: Decimal | null; reason: string | null } {
  const n = d(numerator);
  const t = d(denominator);
  if (t.isZero()) {
    // Zero denominator means no activity in this factor at all.
    return { factor: null, reason: 'total is zero — no activity in this factor' };
  }
  if (n.lessThan(0) || t.lessThan(0)) {
    return { factor: null, reason: 'negative amounts are not accepted' };
  }
  if (n.greaterThan(t)) {
    return { factor: null, reason: 'in-state amount exceeds total' };
  }
  return { factor: n.div(t), reason: null };
}

/**
 * Computes the apportionment fraction for one state. Pure and deterministic.
 * Never throws for numeric inputs.
 */
export function calculateStateApportionment(input: StateFactorsInput): StateApportionmentResult {
  const base: StateApportionmentResult = {
    stateCode: input.stateCode,
    status: 'ok',
    reason: '',
    payrollFactor: null,
    propertyFactor: null,
    salesFactor: null,
    apportionmentFraction: null,
  };

  const payroll = factorFor(input.payrollInState, input.payrollTotal);
  const property = factorFor(input.propertyInState, input.propertyTotal);
  const sales = factorFor(input.salesInState, input.salesTotal);

  for (const [name, r] of [
    ['payroll', payroll],
    ['property', property],
    ['sales', sales],
  ] as const) {
    if (r.reason) {
      base.status = r.reason === 'total is zero — no activity in this factor' ? 'no_activity' : 'invalid_factors';
      base.reason = `${name}: ${r.reason}`;
      return base;
    }
  }

  const wPayroll = input.weightPayroll !== undefined ? d(input.weightPayroll) : THIRD;
  const wProperty = input.weightProperty !== undefined ? d(input.weightProperty) : THIRD;
  const wSales = input.weightSales !== undefined ? d(input.weightSales) : THIRD;

  for (const [name, w] of [
    ['payroll', wPayroll],
    ['property', wProperty],
    ['sales', wSales],
  ] as const) {
    if (w.lessThan(0) || w.greaterThan(1)) {
      base.status = 'invalid_weights';
      base.reason = `${name} weight must be in [0,1]`;
      return base;
    }
  }
  const weightSum = wPayroll.plus(wProperty).plus(wSales);
  if (weightSum.minus(1).abs().greaterThan(WEIGHT_TOLERANCE)) {
    base.status = 'invalid_weights';
    base.reason = `weights must sum to 1 (got ${weightSum.toString()})`;
    return base;
  }

  base.payrollFactor = payroll.factor;
  base.propertyFactor = property.factor;
  base.salesFactor = sales.factor;
  base.apportionmentFraction = wPayroll
    .times(payroll.factor as Decimal)
    .plus(wProperty.times(property.factor as Decimal))
    .plus(wSales.times(sales.factor as Decimal));

  return base;
}

/**
 * Applies an apportionment fraction to apportionable income.
 *
 * UNVALIDATED: "apportionable income" is assumed to be the single-entity
 * taxable income figure the caller computed; what exactly enters the
 * apportionable base (e.g. after addbacks and before net operating losses)
 * is a state-law question this skeleton does not answer.
 */
export function apportionIncome(fraction: Decimal.Value, apportionableIncome: Decimal.Value): Decimal {
  return d(fraction).times(d(apportionableIncome));
}
