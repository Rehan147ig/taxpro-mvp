// ── US State Tax Rule Engine — machine-readable rulesets for 50 states + DC ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every rate, bracket flag, and weight
// below is a SNAPSHOT to be verified against the current state statute before
// any use. The `verify` flags on each ruleset are the checklist for that
// verification; they are not claims of correctness.
//
// This module turns `STATE_TAX_REFERENCE` (prose) into machine-readable rules
// the engine can execute:
//   - filingType: whether the jurisdiction levies an income tax at all
//     ('cit' = corporate income/excise/BPT tax; 'grossReceipts' = the state
//     substitutes a gross-receipts/margin tax for a CIT and an income-based
//     computation would be wrong; 'none' = no such tax).
//   - schedule: 'flat' = single rate on the whole base; 'bracketed' = the
//     state's tax is tiered — only the TOP tier rate is stored here, and the
//     engine warns that applying it to the full base may overstate tax at
//     lower incomes until bracket detail is validated.
//   - weights: apportionment factor weights. Default single sales factor
//     (0/0/1) — the dominant modern formula; EQUAL three-factor for AK, DE,
//     HI, MT as commonly cited. Verify every weight.
//
// Rates are taken from `STATE_TAX_REFERENCE.topRate` (single source of truth
// — change a rate in ONE place).
//
// Known structural notes (all to be verified):
//   - 'grossReceipts' substitutes: OH (commercial activity tax), TX (margin
//     tax), WA (B&O), NV (commerce tax). 'none': SD, WY.
//   - Several CIT states layer franchise/gross-receipts surtaxes (DE, NJ,
//     NY, NH, TN, PA…) — those surcharges are NOT modeled; the engine
//     computes the income tax only and flags the gap on the affected rows.

import { STATE_TAX_REFERENCE, type StateTaxReference } from './state-rates.js';

export type StateFilingType = 'cit' | 'grossReceipts' | 'none';
export type RateScheduleKind = 'flat' | 'bracketed';

export interface StateApportionmentWeights {
  payroll: number;
  property: number;
  sales: number;
}

export interface StateRuleset {
  stateCode: string;
  stateName: string;
  filingType: StateFilingType;
  /** Rate schedule: rate is the flat rate or the TOP TIER of a bracketed state. */
  schedule: { kind: RateScheduleKind; rate: number };
  apportionmentWeights: StateApportionmentWeights;
  /** Data-quality checklist — every entry must be verified before use. */
  verify: string[];
  cite: string;
  /** Fidelity gaps for this jurisdiction (surtaxes, franchise add-ons…). */
  notModeled: string[];
}

const EQUAL: StateApportionmentWeights = { payroll: 1 / 3, property: 1 / 3, sales: 1 / 3 };
const SINGLE_SALES: StateApportionmentWeights = { payroll: 0, property: 0, sales: 1 };

const VERIFY_ALL = 'rate, filing type and apportionment weight verified against current statute';
const VERIFY_WEIGHTS = 'apportionment weights verified against current statute';
const VERIFY_RATE = 'rate and schedule kind verified against current statute';

interface StateRuleConfig {
  filingType?: StateFilingType; // default 'cit'
  scheduleKind: RateScheduleKind;
  weights?: StateApportionmentWeights; // default single sales
  verify?: string[];
  notModeled?: string[];
}

const CONFIG: Record<string, StateRuleConfig> = {
  AL: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  AK: { scheduleKind: 'bracketed', weights: EQUAL, verify: [VERIFY_ALL, 'brackets (0–9.4%) not modeled — top tier applied to full base'] },
  AZ: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  AR: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  CA: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['franchise tax on some capital-based entities (S-corps/LLCs) not modeled'] },
  CO: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['franchise fee (as applicable) not modeled'] },
  CT: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, '10% surcharge (when in effect) not modeled; brackets not modeled'], notModeled: ['capital base tax as applicable not modeled'] },
  DE: { scheduleKind: 'flat', weights: EQUAL, verify: [VERIFY_ALL], notModeled: ['gross receipts licensing tax not modeled'] },
  FL: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  GA: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  HI: { scheduleKind: 'bracketed', weights: EQUAL, verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  ID: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  IL: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['replacement surcharge structure (7% + 2.5%) modeled as a single 9.5% rate'] },
  IN: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['phase-down of the rate not modeled'] },
  IA: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  KS: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  KY: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  LA: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  ME: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  MD: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['local add-ons included in the 8.25% composite rate; county-level variation not modeled'] },
  MA: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['15% excise surtax (as applicable) not modeled'] },
  MI: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  MN: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  MS: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  MO: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  MT: { scheduleKind: 'flat', weights: EQUAL, verify: [VERIFY_ALL] },
  NE: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  NV: { scheduleKind: 'flat', filingType: 'grossReceipts', verify: [VERIFY_ALL], notModeled: ['commerce tax is gross-revenue based — income-tax computation not applicable'] },
  NH: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'], notModeled: ['BPT apportionment uses a different numerator set than the CIT factors; verify'] },
  NJ: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'], notModeled: ['franchise/alternative minimum tax as applicable not modeled'] },
  NM: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  NY: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'], notModeled: ['MTA surcharge (as applicable) not modeled'] },
  NC: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  ND: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  OH: { scheduleKind: 'flat', filingType: 'grossReceipts', verify: [VERIFY_ALL], notModeled: ['commercial activity tax is gross-receipts based — income-tax computation not applicable'] },
  OK: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  OR: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  PA: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  RI: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  SC: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  SD: { scheduleKind: 'flat', filingType: 'none', verify: [VERIFY_ALL] },
  TN: { scheduleKind: 'flat', verify: [VERIFY_ALL], notModeled: ['franchise tax (separate from the excise tax) not modeled'] },
  TX: { scheduleKind: 'flat', filingType: 'grossReceipts', verify: [VERIFY_ALL], notModeled: ['margin tax is gross-margin based — income-tax computation not applicable'] },
  UT: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  VT: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  VA: { scheduleKind: 'flat', verify: [VERIFY_ALL] },
  WA: { scheduleKind: 'flat', filingType: 'grossReceipts', verify: [VERIFY_ALL], notModeled: ['B&O tax is gross-receipts based — income-tax computation not applicable'] },
  WV: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  WI: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
  WY: { scheduleKind: 'flat', filingType: 'none', verify: [VERIFY_ALL] },
  DC: { scheduleKind: 'bracketed', verify: [VERIFY_ALL, 'brackets not modeled — top tier applied to full base'] },
};

function buildRulesets(): StateRuleset[] {
  const byCode = new Map(STATE_TAX_REFERENCE.map(s => [s.stateCode, s]));
  const out: StateRuleset[] = [];
  for (const [code, cfg] of Object.entries(CONFIG)) {
    const ref: StateTaxReference | undefined = byCode.get(code);
    if (!ref) throw new Error(`STATE_RULESET references '${code}' which is absent from STATE_TAX_REFERENCE`);
    out.push({
      stateCode: ref.stateCode,
      stateName: ref.stateName,
      filingType: cfg.filingType ?? 'cit',
      schedule: { kind: cfg.scheduleKind, rate: ref.topRate },
      apportionmentWeights: cfg.weights ?? SINGLE_SALES,
      verify: cfg.verify ?? [VERIFY_WEIGHTS],
      cite: ref.cite,
      notModeled: cfg.notModeled ?? [],
    });
  }
  return out.sort((a, b) => (a.stateCode < b.stateCode ? -1 : 1));
}

/** Machine-readable rules for all 51 jurisdictions (50 states + DC). */
export const STATE_RULESET: readonly StateRuleset[] = buildRulesets();

const RULESET_INDEX = new Map(STATE_RULESET.map(r => [r.stateCode, r]));

/** Looks up the ruleset for a state code. Returns undefined for unknown codes. */
export function stateRuleset(stateCode: string): StateRuleset | undefined {
  return RULESET_INDEX.get(stateCode.toUpperCase());
}
