// ── Verifier: diffs STATE_RULESET against dated external snapshots ──
//
// The engine's data is only as fresh as its last verification. This module
// compares the machine-readable ruleset against the dated external snapshots
// in `external-snapshots.ts` and reports every mismatch (rate, schedule kind,
// filing type). CI runs this via `npm run verify:us-rates`; the verification
// test in `state-rules.test.ts` fails whenever the ruleset drifts from the
// latest snapshot — stale tax data becomes a failing test, not a silent error.

import { STATE_RULESET } from './state-rules.js';
import { EXTERNAL_SNAPSHOTS, type SnapshotRow } from './external-snapshots.js';

export type MismatchKind =
  | 'missingRuleset'
  | 'missingSnapshot'
  | 'rateMismatch'
  | 'scheduleKindMismatch'
  | 'filingTypeMismatch';

export interface RateMismatch {
  stateCode: string;
  kind: MismatchKind;
  /** Ruleset value (undefined when the ruleset lacks the row). */
  ruleset?: { rate: number; scheduleKind: string; filingType: string };
  /** Snapshot value (undefined when the snapshot lacks the row). */
  snapshot?: { rate: number; scheduleKind: string; filingType: string };
  detail: string;
}

export interface RateVerificationReport {
  /** Source the ruleset was checked against. */
  sourceName: string;
  sourceUrl: string;
  taxYear: number;
  publishedAt: string;
  fetchedAt: string;
  jurisdictionsChecked: number;
  matches: number;
  mismatches: RateMismatch[];
  /** True when every snapshot row matches the ruleset exactly. */
  clean: boolean;
}

function num(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

/**
 * Diffs `STATE_RULESET` against one dated external snapshot. Pure function —
 * no I/O, no side effects; easy to unit test.
 */
export function verifyRulesetAgainstSnapshot(snapshot: {
  source: { name: string; url: string; taxYear: number; publishedAt: string; fetchedAt: string };
  rows: readonly SnapshotRow[];
}): RateVerificationReport {
  const byCode = new Map(STATE_RULESET.map(r => [r.stateCode, r]));
  const mismatches: RateMismatch[] = [];
  let matches = 0;

  for (const row of snapshot.rows) {
    const before = mismatches.length;
    const rule = byCode.get(row.stateCode);
    if (!rule) {
      mismatches.push({
        stateCode: row.stateCode,
        kind: 'missingRuleset',
        snapshot: { rate: row.topRate, scheduleKind: row.scheduleKind, filingType: row.filingType },
        detail: `Snapshot has ${row.stateCode} but STATE_RULESET does not`,
      });
      continue;
    }
    if (rule.schedule.rate !== row.topRate) {
      mismatches.push({
        stateCode: row.stateCode,
        kind: 'rateMismatch',
        ruleset: { rate: rule.schedule.rate, scheduleKind: rule.schedule.kind, filingType: rule.filingType },
        snapshot: { rate: row.topRate, scheduleKind: row.scheduleKind, filingType: row.filingType },
        detail: `Rate ${num(rule.schedule.rate)} (ruleset) != ${num(row.topRate)} (${snapshot.source.name})`,
      });
    }
    if (rule.schedule.kind !== row.scheduleKind) {
      mismatches.push({
        stateCode: row.stateCode,
        kind: 'scheduleKindMismatch',
        ruleset: { rate: rule.schedule.rate, scheduleKind: rule.schedule.kind, filingType: rule.filingType },
        snapshot: { rate: row.topRate, scheduleKind: row.scheduleKind, filingType: row.filingType },
        detail: `Schedule '${rule.schedule.kind}' (ruleset) != '${row.scheduleKind}' (${snapshot.source.name})`,
      });
    }
    if (rule.filingType !== row.filingType) {
      mismatches.push({
        stateCode: row.stateCode,
        kind: 'filingTypeMismatch',
        ruleset: { rate: rule.schedule.rate, scheduleKind: rule.schedule.kind, filingType: rule.filingType },
        snapshot: { rate: row.topRate, scheduleKind: row.scheduleKind, filingType: row.filingType },
        detail: `Filing type '${rule.filingType}' (ruleset) != '${row.filingType}' (${snapshot.source.name})`,
      });
    }
    if (mismatches.length === before) {
      matches += 1;
    }
  }

  for (const rule of STATE_RULESET) {
    const hasRow = snapshot.rows.some(r => r.stateCode === rule.stateCode);
    if (!hasRow) {
      mismatches.push({
        stateCode: rule.stateCode,
        kind: 'missingSnapshot',
        ruleset: { rate: rule.schedule.rate, scheduleKind: rule.schedule.kind, filingType: rule.filingType },
        detail: `STATE_RULESET has ${rule.stateCode} but the ${snapshot.source.name} snapshot does not`,
      });
    }
  }

  return {
    sourceName: snapshot.source.name,
    sourceUrl: snapshot.source.url,
    taxYear: snapshot.source.taxYear,
    publishedAt: snapshot.source.publishedAt,
    fetchedAt: snapshot.source.fetchedAt,
    jurisdictionsChecked: snapshot.rows.length,
    matches,
    mismatches,
    clean: mismatches.length === 0,
  };
}

/** Verifies the ruleset against EVERY dated external snapshot. */
export function verifyAllSnapshots(): RateVerificationReport[] {
  return EXTERNAL_SNAPSHOTS.map(verifyRulesetAgainstSnapshot);
}
