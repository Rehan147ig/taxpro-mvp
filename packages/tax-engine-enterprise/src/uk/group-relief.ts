// ── UK Group Relief — CTA 2010 Part 5 (pure function) ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// What this calculator does:
//   A loss-making group company surrenders its taxable loss to a profitable
//   group company, which uses it to reduce its own taxable profits. Relief is
//   capped at the claimant's taxable profit for the period.
//
// What this calculator deliberately does NOT handle (explicit non-handled
// gaps, see `GROUP_RELIEF_UNHANDLED_GAPS`):
//   - Consortium relief (CTA 2010 ss.133-153 area). A consortium member's
//     share of a group company's loss is not modelled.
//   - Non-coterminous accounting periods: when the surrendering and claiming
//     companies' periods do not match, the surrender must be apportioned
//     between periods. Not modelled — inputs assume a single shared period.
//   - Carried-forward losses under the post-2017 reform (the £5m group
//     deduction allowance and the 50% "relevant profits" cap, CTA 2010
//     Part 7ZA). This calculator only handles current-period trading losses.
//   - Restricted loss types (e.g. capital losses, unused management expenses
//     from investment companies in some cases) — only a plain taxable loss is
//     accepted.
//   - Statutory claim formalities (claims must be made within a window after
//     the period end — commonly stated as two years, assumed, not enforced).
//
// Determinism: entities are processed in input order for both claimants and
// surrenderers. No sorting is applied, so results are reproducible for a
// given input array.

import { Decimal } from 'decimal.js';

export interface GroupReliefEntity {
  /** Host-app entity id. */
  entityId: string;
  /**
   * Taxable profit for the period. Negative = loss available to surrender.
   * Sign convention: profit positive, loss negative (guessed — a real
   * integration must confirm whether losses arrive signed or as separate
   * loss fields).
   */
  taxableProfit: Decimal.Value;
  /** Optional display label (e.g. "Parent Ltd"). */
  label?: string;
}

export interface GroupReliefStep {
  /** 1-based sequence number of the step in the elimination trail. */
  sequence: number;
  kind: 'surrender';
  fromEntityId: string;
  toEntityId: string;
  /** Amount surrendered in this step, rounded to 2dp (GBP pence). */
  surrendered: Decimal;
  /** Claimant's remaining profit after this step. */
  remainingClaimantProfit: Decimal;
  /** Surrenderer's remaining loss (absolute value) after this step. */
  remainingSurrendererLoss: Decimal;
  /**
   * Why the amount was chosen:
   * - 'full' — surrenderer's loss fully used
   * - 'claimant_capped' — limited by claimant's remaining profit (the
   *   statutory cap: relief cannot exceed the claimant's taxable profits)
   * - 'partially_absorbed' — partial use, both sides still have balances
   */
  reason: 'full' | 'claimant_capped' | 'partially_absorbed';
}

export interface GroupReliefEntityOutcome {
  entityId: string;
  taxableProfit: Decimal;
  /** For claimants: total relief received (reduces taxable profit). */
  reliefReceived: Decimal;
  /** For loss-makers: total loss surrendered. */
  reliefSurrendered: Decimal;
  /** Claimant's profit left after all surrenders (>= 0). */
  remainingProfit: Decimal;
  /** Loss-maker's remaining loss as a positive number (0 if fully used). */
  remainingLoss: Decimal;
  status: 'claimant' | 'surrenderer' | 'neutral';
}

export interface GroupReliefResult {
  period?: string;
  entities: GroupReliefEntityOutcome[];
  /** Elimination trail, in execution order. */
  steps: GroupReliefStep[];
  totalLossesSurrendered: Decimal;
  totalReliefUtilised: Decimal;
  /** Identifiers of the rules this calculator does NOT implement. */
  unhandledGaps: string[];
}

/**
 * Rules that exist in CTA 2010 Part 5 (and the wider legislation) but are
 * deliberately out of scope for this exploratory calculator. See ASSUMPTIONS.md
 * for what would be needed to support each.
 */
export const GROUP_RELIEF_UNHANDLED_GAPS: readonly string[] = [
  'consortium_relief', // CTA 2010 ss.133-153 area — consortium member relief not modelled
  'non_coterminous_periods', // surrender apportionment across mismatched accounting periods not modelled
  'carried_forward_losses', // post-2017 reform: £5m group allowance + 50% relevant-profits cap not modelled
  'restricted_loss_types', // only plain current-period trading losses accepted (guessed)
  'claim_window', // statutory claim deadline (assumed two years after period end) not enforced
] as const;

const TWO_DP = 2;

function d(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Pure group-relief calculation. Never throws for numeric inputs; division by
 * zero does not occur here. Inputs are rounded to 2dp before use.
 */
export function calculateGroupRelief(
  entities: GroupReliefEntity[],
  options: { period?: string } = {},
): GroupReliefResult {
  const outcomes: GroupReliefEntityOutcome[] = entities.map((e) => {
    const profit = d(e.taxableProfit);
    return {
      entityId: e.entityId,
      taxableProfit: profit,
      reliefReceived: new Decimal(0),
      reliefSurrendered: new Decimal(0),
      remainingProfit: profit.greaterThan(0) ? profit : new Decimal(0),
      remainingLoss: profit.lessThan(0) ? profit.abs() : new Decimal(0),
      status: profit.greaterThan(0)
        ? ('claimant' as const)
        : profit.lessThan(0)
          ? ('surrenderer' as const)
          : ('neutral' as const),
    };
  });

  const claimants = outcomes.filter((o) => o.status === 'claimant');
  const surrenderers = outcomes.filter((o) => o.status === 'surrenderer');

  const steps: GroupReliefStep[] = [];
  let sequence = 0;

  // Deterministic greedy pass: claimants in input order, each absorbing
  // surrenderers' losses in input order, capped at the claimant's remaining
  // profit. A different order (e.g. largest loss first) would give different
  // results — the chosen order is an assumption, see ASSUMPTIONS.md.
  for (const claimant of claimants) {
    for (const surrenderer of surrenderers) {
      if (claimant.remainingProfit.lessThanOrEqualTo(0)) break;
      if (surrenderer.remainingLoss.lessThanOrEqualTo(0)) continue;

      const available = surrenderer.remainingLoss;
      const capacity = claimant.remainingProfit;
      const amount = Decimal.min(available, capacity).toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
      if (amount.lessThanOrEqualTo(0)) continue;

      const fullUse = amount.equals(available);
      const capped = amount.equals(capacity) && !fullUse;
      sequence += 1;
      steps.push({
        sequence,
        kind: 'surrender',
        fromEntityId: surrenderer.entityId,
        toEntityId: claimant.entityId,
        surrendered: amount,
        remainingClaimantProfit: capacity.minus(amount),
        remainingSurrendererLoss: available.minus(amount),
        reason: fullUse ? 'full' : capped ? 'claimant_capped' : 'partially_absorbed',
      });

      claimant.reliefReceived = claimant.reliefReceived.plus(amount);
      claimant.remainingProfit = claimant.remainingProfit.minus(amount);
      surrenderer.reliefSurrendered = surrenderer.reliefSurrendered.plus(amount);
      surrenderer.remainingLoss = surrenderer.remainingLoss.minus(amount);
    }
  }

  const totalLossesSurrendered = outcomes.reduce((acc, o) => acc.plus(o.reliefSurrendered), new Decimal(0));
  const totalReliefUtilised = outcomes.reduce((acc, o) => acc.plus(o.reliefReceived), new Decimal(0));

  return {
    period: options.period,
    entities: outcomes,
    steps,
    totalLossesSurrendered,
    totalReliefUtilised,
    unhandledGaps: [...GROUP_RELIEF_UNHANDLED_GAPS],
  };
}
