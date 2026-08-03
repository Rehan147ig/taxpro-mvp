// ── US Valuation Allowance Scheduler — ASC 740-30 mechanics ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// This module computes the ARITHMETIC of a valuation allowance: deferred tax
// assets are recognized only to the extent that realization is more likely
// than not (ASC 740-10-30-5); a valuation allowance reduces the deferred tax
// asset by the portion expected NOT to be realized. It does NOT determine
// realizability — that judgment belongs to the preparer. The module only:
//   - allocates a user-supplied allowance across DTA sources (pro-rata by
//     balance) with a configurable allocation order,
//   - tracks expiry-year exposure so the caller can see which sources turn
//     into a cash tax benefit before they lapse,
//   - flags scheduling red flags (sources expiring before reversal years)
//     as warnings, never as corrections.
//
// General (guessed) assumptions, all UNVALIDATED:
//   - Pro-rata allocation of the VA is a common practical heuristic; the
//     allocation order can be supplied explicitly. No statute prescribes it.
//   - "Reversal year" is a caller-supplied estimate of when a deferred tax
//     liability will turn, making room for the asset — ASC 740-10-55 guidance
//     (scheduling) is referenced as a pointer only.
//   - No interest/tax-rate change effects are modeled.
//   - The allowance is applied to DTAs net of any offsetting DTIs ONLY if the
//     caller passes net-of-DTL source balances; this module does not net.

import { Decimal } from 'decimal.js';

export type DtaSourceKind = 'nol' | 'credit' | 'temporary' | 'other';

export interface DtaSourceInput {
  /** Stable identifier, e.g. 'NOL-FY2024' or 'R&D-credit'. */
  id: string;
  kind: DtaSourceKind;
  /** Deferred tax asset balance BEFORE valuation allowance, >= 0. */
  balance: Decimal.Value;
  /**
   * Expiry year (e.g. 2030) of the source, when it lapses unused (credits and
   * pre-2018 NOL carryforwards typically expire; post-2017 NOL carryforwards
   * do not — use a sentinel such as 0 for 'indefinite').
   */
  expiryYear: number;
  /**
   * Earliest year in which a taxable reversal is expected to make the asset
   * utilizable. 0 = unknown/indefinite. Used only for warnings.
   */
  expectedReversalYear: number;
}

export interface ValuationAllowanceInput {
  sources: DtaSourceInput[];
  /** Total valuation allowance the preparer judged necessary (>= 0). */
  valuationAllowance: Decimal.Value;
  /**
   * Optional strict allocation order (source ids). Sources listed first absorb
   * the allowance first. Defaults to oldest expiry first, then id.
   */
  allocationOrder?: string[];
}

export type VaWarningKind =
  | 'negative_balance'
  | 'expires_before_reversal'
  | 'allowance_exceeds_assets';

export interface VaWarning {
  kind: VaWarningKind;
  message: string;
}

export interface VaSourceAllocation {
  id: string;
  kind: DtaSourceKind;
  grossBalance: Decimal;
  allowanceApplied: Decimal;
  netBalance: Decimal;
  expiryYear: number;
  expectedReversalYear: number;
  expiresBeforeReversal: boolean;
}

export interface ValuationAllowanceResult {
  sources: VaSourceAllocation[];
  grossDeferredTaxAssets: Decimal;
  totalAllowance: Decimal;
  netDeferredTaxAssets: Decimal;
  warnings: VaWarning[];
}

function d(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

/**
 * Allocates a valuation allowance across deferred tax assets and reports the
 * net deferred tax asset balance. Pure and deterministic. Never throws for
 * numeric inputs; negative balances and over-allocations surface as warnings
 * with the allowance clamped to the gross DTA total.
 */
export function scheduleValuationAllowance(input: ValuationAllowanceInput): ValuationAllowanceResult {
  const sources = [...input.sources];
  const warnings: VaWarning[] = [];

  const gross = d(sources.reduce((sum, s) => sum + Math.max(0, d(s.balance).toNumber()), 0));
  let allowance = d(input.valuationAllowance);

  for (const s of sources) {
    if (d(s.balance).isNegative()) {
      warnings.push({ kind: 'negative_balance', message: `source '${s.id}' has a negative DTA balance (${s.balance}) — treated as zero` });
    }
    if (s.expiryYear > 0 && s.expectedReversalYear > 0 && s.expiryYear <= s.expectedReversalYear) {
      warnings.push({
        kind: 'expires_before_reversal',
        message: `source '${s.id}' expires ${s.expiryYear} before the earliest expected reversal year ${s.expectedReversalYear} — realization is not schedulable`,
      });
    }
  }

  if (allowance.isNegative()) {
    warnings.push({ kind: 'allowance_exceeds_assets', message: `valuation allowance ${allowance} is negative — clamped to zero` });
    allowance = new Decimal(0);
  }
  if (allowance.greaterThan(gross)) {
    warnings.push({
      kind: 'allowance_exceeds_assets',
      message: `valuation allowance ${allowance} exceeds gross deferred tax assets ${gross} — clamped to the gross balance`,
    });
    allowance = gross;
  }

  const byOrder = new Map(sources.map(s => [s.id, s]));
  const ordered = [...sources].sort((a, b) => {
    const ia = input.allocationOrder?.indexOf(a.id) ?? -1;
    const ib = input.allocationOrder?.indexOf(b.id) ?? -1;
    if (ia !== ib) return ia - ib; // -1 sorts after explicit positions
    if (a.expiryYear !== b.expiryYear) return a.expiryYear - b.expiryYear;
    return a.id < b.id ? -1 : 1;
  });

  let remaining = allowance;
  const allocations: VaSourceAllocation[] = ordered.map(s => {
    const grossBalance = d(s.balance).isNegative() ? new Decimal(0) : d(s.balance);
    const applied = remaining.greaterThan(0) ? Decimal.min(remaining, grossBalance) : new Decimal(0);
    remaining = remaining.minus(applied);
    return {
      id: s.id,
      kind: s.kind,
      grossBalance,
      allowanceApplied: applied,
      netBalance: grossBalance.minus(applied),
      expiryYear: s.expiryYear,
      expectedReversalYear: s.expectedReversalYear,
      expiresBeforeReversal: s.expiryYear > 0 && s.expectedReversalYear > 0 && s.expiryYear <= s.expectedReversalYear,
    };
  });

  return {
    sources: allocations,
    grossDeferredTaxAssets: gross,
    totalAllowance: allowance,
    netDeferredTaxAssets: gross.minus(allowance),
    warnings,
  };
}
