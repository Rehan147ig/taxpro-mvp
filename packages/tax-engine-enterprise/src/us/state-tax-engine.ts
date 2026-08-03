// ── US State Tax Computation Engine — executes STATE_RULESET per state ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every rate, bracket flag, and weight
// lives in `state-rules.ts` as reference DATA with verify flags; this module
// only executes that data. The output is therefore only as trustworthy as the
// ruleset verification — do not rely on it before the `verify` checklists are
// cleared.
//
// Pipeline per state (pure, deterministic, Decimal):
//   1. Resolve the jurisdiction ruleset. 'none' → zero tax (no CIT).
//      'grossReceipts' → structured 'not_income_based' result (an income-tax
//      computation would be WRONG for OH/TX/WA/NV — the caller must use the
//      gross-receipts/margin basis instead; not implemented here).
//   2. Apportion: fraction = Σ weight_i × factor_i via
//      `calculateStateApportionment` (factor totals supplied by the caller —
//      state-correct numerator/denominator definitions are the caller's
//      responsibility; see apportionment.ts TODOs).
//   3. State taxable income = apportionable income × fraction.
//   4. Rate: flat → single rate; bracketed → TOP TIER rate applied to the
//      full base with an explicit warning (may overstate at lower incomes —
//      bracket detail is UNVALIDATED).
//   5. State tax = max(0, state taxable income) × rate.
//
// States with missing factor data are reported 'insufficient_factors' and
// EXCLUDED from the multistate total — silently dropping them would
// understate the total tax burden.

import { Decimal } from 'decimal.js';
import { calculateStateApportionment, type StateFactorsInput } from './apportionment.js';
import { stateRuleset, type StateFilingType } from './state-rules.js';

export interface StateTaxComputationInput {
  /** Pre-apportionment taxable income (the single-entity apportionable base). */
  apportionableIncome: Decimal.Value;
  /** Per-state factor data (payroll/property/sales numerators and totals). */
  factorsByState: Record<string, StateFactorsInput>;
  /** Per-state statutory rate overrides (Decimal.Value). */
  rateOverrideByState?: Record<string, Decimal.Value>;
  /** Per-state apportionment weight overrides (defaults from the ruleset). */
  weightOverrideByState?: Record<string, { payroll?: Decimal.Value; property?: Decimal.Value; sales?: Decimal.Value }>;
}

export type StateComputationStatus = 'computed' | 'no_cit' | 'not_income_based' | 'insufficient_factors';

export interface StateComputationResult {
  stateCode: string;
  filingType: StateFilingType;
  status: StateComputationStatus;
  reason?: string;
  apportionmentFraction: Decimal | null;
  stateTaxableIncome: Decimal | null;
  rateApplied: Decimal | null;
  stateTax: Decimal | null;
  warnings: string[];
}

export interface StateTaxComputationResult {
  states: StateComputationResult[];
  /** Sum of state tax over all 'computed' states. */
  totalMultistateTax: Decimal;
  /** Number of states whose tax is included in the total. */
  statesIncluded: number;
  warnings: string[];
  basis: string;
}

const BASIS =
  'US state tax rule engine: per-jurisdiction filing type, apportionment weights and rate schedule from ' +
  'STATE_RULESET (UNVALIDATED reference data — every row carries a verify checklist); state taxable income = ' +
  'apportionable income × apportionment fraction (factor totals supplied by the caller); bracketed states apply ' +
  'the TOP TIER rate to the full base (may overstate); gross-receipts/margin states (OH, TX, WA, NV) are excluded ' +
  'as not income-based; states without factor data are excluded with a reason; no throwback, no combined/unitary, ' +
  'no surcharges/franchise add-ons (flagged per state).';

function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/**
 * Computes apportioned state tax for every supplied jurisdiction. Pure and
 * deterministic. Never throws for numeric inputs.
 */
export function computeStateTaxes(input: StateTaxComputationInput): StateTaxComputationResult {
  const states: StateComputationResult[] = [];
  const warnings: string[] = [];

  for (const [code, factors] of Object.entries(input.factorsByState)) {
    const rules = stateRuleset(code);
    if (!rules) {
      warnings.push(`no ruleset for '${code}' — excluded from the multistate total`);
      continue;
    }

    const base: StateComputationResult = {
      stateCode: rules.stateCode,
      filingType: rules.filingType,
      status: 'computed',
      apportionmentFraction: null,
      stateTaxableIncome: null,
      rateApplied: null,
      stateTax: null,
      warnings: [],
    };

    if (rules.filingType === 'none') {
      states.push({ ...base, status: 'no_cit', reason: 'no corporate income tax in this jurisdiction' });
      continue;
    }
    if (rules.filingType === 'grossReceipts') {
      states.push({
        ...base,
        status: 'not_income_based',
        reason: 'this jurisdiction taxes gross receipts/margin, not income — an income-tax computation would be wrong',
      });
      continue;
    }

    const override = input.weightOverrideByState?.[code];
    const apportioned = calculateStateApportionment({
      stateCode: code,
      payrollInState: factors.payrollInState,
      payrollTotal: factors.payrollTotal,
      propertyInState: factors.propertyInState,
      propertyTotal: factors.propertyTotal,
      salesInState: factors.salesInState,
      salesTotal: factors.salesTotal,
      weightPayroll: override?.payroll ?? rules.apportionmentWeights.payroll,
      weightProperty: override?.property ?? rules.apportionmentWeights.property,
      weightSales: override?.sales ?? rules.apportionmentWeights.sales,
    });

    if (apportioned.status !== 'ok' || apportioned.apportionmentFraction === null) {
      states.push({
        ...base,
        status: 'insufficient_factors',
        reason: apportioned.reason || 'apportionment could not be computed',
      });
      continue;
    }

    const stateTaxableIncome = d(input.apportionableIncome).times(apportioned.apportionmentFraction);
    const rate = input.rateOverrideByState?.[code] ?? rules.schedule.rate;
    const tax = Decimal.max(0, stateTaxableIncome).times(d(rate));

    const stateWarnings: string[] = [];
    if (rules.schedule.kind === 'bracketed') {
      stateWarnings.push(`bracketed rate — top tier (${rules.schedule.rate}) applied to the full base; may overstate at lower incomes`);
    }
    if (stateTaxableIncome.isNegative()) {
      stateWarnings.push('negative state taxable income — tax floored at zero (loss)');
    }
    for (const gap of rules.notModeled) {
      stateWarnings.push(`not modeled: ${gap}`);
    }

    states.push({
      ...base,
      apportionmentFraction: apportioned.apportionmentFraction,
      stateTaxableIncome,
      rateApplied: d(rate),
      stateTax: tax,
      warnings: stateWarnings,
    });
  }

  // Deterministic output order: state code ascending.
  states.sort((a, b) => (a.stateCode < b.stateCode ? -1 : 1));

  const included = states.filter(s => s.status === 'computed' && s.stateTax !== null);
  const total = included.reduce((sum, s) => sum.plus(s.stateTax as Decimal), new Decimal(0));
  warnings.push(...included.flatMap(s => s.warnings.map(w => `${s.stateCode}: ${w}`)));

  return {
    states,
    totalMultistateTax: total,
    statesIncluded: included.length,
    warnings,
    basis: BASIS,
  };
}
