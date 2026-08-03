// ── US state rates verification runner (CI-runnable) ──
//
// Diffs STATE_RULESET against every dated external snapshot and FAILS on any
// mismatch. Run: `npm run verify:us-rates`. The printed report shows what was
// checked, against which source, and exactly which rows drifted.

import { describe, it, expect } from 'vitest';
import { verifyAllSnapshots } from '../src/us/verify-rates.js';

describe('STATE_RULESET vs dated external snapshots', () => {
  it('matches every snapshot exactly', () => {
    const reports = verifyAllSnapshots();
    expect(reports.length).toBeGreaterThan(0);

    const lines: string[] = [];
    for (const r of reports) {
      lines.push(`=== ${r.sourceName} (${r.taxYear}) — ${r.sourceUrl}`);
      lines.push(`    published ${r.publishedAt}, captured ${r.fetchedAt}, tax year ${r.taxYear}`);
      lines.push(`    jurisdictions checked: ${r.jurisdictionsChecked}, exact matches: ${r.matches}, mismatches: ${r.mismatches.length}`);
      for (const m of r.mismatches) {
        lines.push(`    [${m.stateCode}] ${m.kind}: ${m.detail}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    for (const r of reports) {
      expect(r.clean, [
        `${r.sourceName} (${r.taxYear}): ${r.mismatches.length} mismatches — ruleset is stale against ${r.sourceUrl}`,
        ...r.mismatches.map(m => `  [${m.stateCode}] ${m.kind}: ${m.detail}`),
      ].join('\n')).toBe(true);
    }
  });
});
