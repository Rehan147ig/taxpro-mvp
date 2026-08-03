// ── Rule-update proposals — the machine-checkable output of the agentic
//    rule-refresh loop ──
//
// A `RulesetProposal` is a candidate change to STATE_RULESET produced by an
// extraction agent from a dated legal source (statute text, revenue bulletin,
// or published rate table). It is deliberately shaped EXACTLY like the
// fields the engine executes, so the loop is:
//
//   source text → agent extracts proposal → validateProposal (deterministic
//   sanity checks) → diffProposalAgainstRuleset (what would change) → human
//   CPA approval → ruleset + snapshot updated together → verifier + engine
//   tests gate the change.
//
// Everything here is deterministic and testable without an LLM — the agent
// may be AI, but the contract it must satisfy is pure data.

import { STATE_RULESET, type StateApportionmentWeights, type StateFilingType, type RateScheduleKind } from './state-rules.js';

export type ProposalFilingType = StateFilingType;
export type ProposalScheduleKind = RateScheduleKind;

export interface RuleSource {
  /** Short human name of the source. */
  name: string;
  /** Stable URL of the source document. */
  url: string;
  /** Publication date of the source edition (ISO date). */
  publishedAt: string;
}

export interface RulesetProposal {
  stateCode: string;
  /** Tax year the rule is effective for. */
  taxYear: number;
  filingType: ProposalFilingType;
  schedule: { kind: ProposalScheduleKind; rate: number };
  apportionmentWeights?: StateApportionmentWeights;
  /** Dated source the rule was extracted from. */
  source: RuleSource;
  /** The raw legal text the rule was extracted from (audit trail). */
  excerpt: string;
  /** Agent confidence 0..1. */
  confidence: number;
  /** Why this rule was extracted (citations, effective dates…). */
  reasoning: string;
}

export interface ProposalValidation {
  valid: boolean;
  issues: string[];
}

const KNOWN_CODES = new Set(STATE_RULESET.map(r => r.stateCode));

/** Maximum plausible corporate income tax rate (fraction). 20% > every current state rate. */
const MAX_SANE_RATE = 0.2;
const WEIGHT_TOLERANCE = 0.001;

/**
 * Deterministic sanity checks on a proposal. An invalid proposal must never
 * reach the ruleset: agents fail loudly here, never silently coerce.
 */
export function validateProposal(p: RulesetProposal): ProposalValidation {
  const issues: string[] = [];
  const code = p.stateCode.toUpperCase();

  if (!KNOWN_CODES.has(code)) {
    issues.push(`stateCode '${p.stateCode}' is not one of the 51 jurisdictions`);
  }
  if (!Number.isInteger(p.taxYear) || p.taxYear < 2020 || p.taxYear > 2100) {
    issues.push(`taxYear ${p.taxYear} is not a plausible tax year`);
  }
  if (p.filingType !== 'cit' && p.filingType !== 'grossReceipts' && p.filingType !== 'none') {
    issues.push(`filingType '${p.filingType}' must be cit|grossReceipts|none`);
  }
  if (p.schedule.kind !== 'flat' && p.schedule.kind !== 'bracketed') {
    issues.push(`schedule.kind '${p.schedule.kind}' must be flat|bracketed`);
  }
  if (!Number.isFinite(p.schedule.rate) || p.schedule.rate < 0 || p.schedule.rate > MAX_SANE_RATE) {
    issues.push(`schedule.rate ${p.schedule.rate} is outside the sane range 0..${MAX_SANE_RATE}`);
  }
  if (p.apportionmentWeights !== undefined) {
    const w = p.apportionmentWeights;
    const sum = w.payroll + w.property + w.sales;
    if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
      issues.push(`apportionmentWeights sum to ${sum}, not 1`);
    }
    for (const [k, v] of Object.entries(w) as Array<[keyof StateApportionmentWeights, number]>) {
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        issues.push(`apportionmentWeights.${k} ${v} is outside 0..1`);
      }
    }
  }
  if (!p.source?.name || !p.source?.url || !p.source?.publishedAt) {
    issues.push('source name, url and publishedAt are required (provenance)');
  }
  if (!p.excerpt || p.excerpt.trim().length < 10) {
    issues.push('excerpt must contain the raw legal text the rule was extracted from');
  }
  if (!Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) {
    issues.push(`confidence ${p.confidence} must be 0..1`);
  }
  if (!p.reasoning || p.reasoning.trim().length < 10) {
    issues.push('reasoning is required (audit trail)');
  }

  return { valid: issues.length === 0, issues };
}

export interface ProposalDiff {
  stateCode: string;
  /** Current ruleset row (undefined when the state is unknown to the ruleset). */
  current: {
    filingType: string;
    scheduleKind: string;
    rate: number;
    weights: StateApportionmentWeights;
  } | null;
  proposed: {
    filingType: string;
    scheduleKind: string;
    rate: number;
    weights: StateApportionmentWeights | undefined;
  };
  /** Human-readable list of what applying this proposal would change. */
  changes: string[];
  /** True when applying the proposal would change anything. */
  breaking: boolean;
}

const pct = (r: number) => `${(r * 100).toFixed(4)}%`;
const fmtW = (w: StateApportionmentWeights) => `p${w.payroll}/pp${w.property}/s${w.sales}`;

/**
 * What applying the proposal to STATE_RULESET would change. This is the
 * "review summary" a CPA approves — a no-op proposal produces an empty
 * change list and is `breaking: false`.
 */
export function diffProposalAgainstRuleset(p: RulesetProposal): ProposalDiff {
  const code = p.stateCode.toUpperCase();
  const rule = STATE_RULESET.find(r => r.stateCode === code) ?? null;
  const changes: string[] = [];

  const current = rule
    ? {
        filingType: rule.filingType,
        scheduleKind: rule.schedule.kind,
        rate: rule.schedule.rate,
        weights: rule.apportionmentWeights,
      }
    : null;

  const proposedWeights = p.apportionmentWeights ?? { payroll: 0, property: 0, sales: 1 };

  if (rule) {
    if (rule.filingType !== p.filingType) {
      changes.push(`filing type ${rule.filingType} → ${p.filingType}`);
    }
    if (rule.schedule.kind !== p.schedule.kind) {
      changes.push(`schedule ${rule.schedule.kind} → ${p.schedule.kind}`);
    }
    if (rule.schedule.rate !== p.schedule.rate) {
      changes.push(`rate ${pct(rule.schedule.rate)} → ${pct(p.schedule.rate)} (tax year ${p.taxYear})`);
    }
    if (!weightsEqual(rule.apportionmentWeights, proposedWeights)) {
      changes.push(`weights ${fmtW(rule.apportionmentWeights)} → ${fmtW(proposedWeights)}`);
    }
  } else {
    changes.push(`new jurisdiction ${code} not present in STATE_RULESET`);
  }

  return {
    stateCode: code,
    current,
    proposed: {
      filingType: p.filingType,
      scheduleKind: p.schedule.kind,
      rate: p.schedule.rate,
      weights: p.apportionmentWeights,
    },
    changes,
    breaking: changes.length > 0,
  };
}

function weightsEqual(a: StateApportionmentWeights, b: StateApportionmentWeights): boolean {
  return (
    Math.abs(a.payroll - b.payroll) <= WEIGHT_TOLERANCE &&
    Math.abs(a.property - b.property) <= WEIGHT_TOLERANCE &&
    Math.abs(a.sales - b.sales) <= WEIGHT_TOLERANCE
  );
}
