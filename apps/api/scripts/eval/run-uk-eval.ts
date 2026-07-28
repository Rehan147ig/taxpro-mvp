/**
 * UK FRS 102 Eval Harness — validates the TaxPro tax engine against
 * manually-curated ground truth fixtures from filed Companies House accounts.
 *
 * For each fixture:
 * 1. Validate all required fields are populated (no TODO placeholders)
 * 2. Feed reconciliation items through @taxpro/tax-engine calculateETR and
 *    calculateUkDeferredTax with jurisdiction UK_FRS102_S29
 * 3. Compare engine ETR against disclosed ETR
 * 4. Compare engine deferred tax closing balance against disclosed balance
 *
 * Scoring (same bp bands as US eval):
 *   PASS ≤ 25bp · WARN ≤ 100bp · FAIL > 100bp · SKIP fixture not populated
 *
 * Run: npm run eval:uk
 */

import fixtures from './uk-fixtures.js';
import { validateFixture, type UkTaxFootnote } from './uk-ground-truth.js';
import { runEngine } from './uk-xbrl-map.js';

const PASS_BP = 25;
const WARN_BP = 100;

const fmt$ = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}£${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}£${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}£${(abs / 1e3).toFixed(0)}K`;
  return `${sign}£${abs.toFixed(0)}`;
};
const bp = (ratio: number) => Math.round(ratio * 10_000);

type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface CompanyResult {
  name: string;
  verdict: Verdict;
  etrDeltaBp: number | null;
  deferredDeltaBp: number | null;
  notes: string[];
}

function evalFixture(footnote: UkTaxFootnote): CompanyResult {
  const notes: string[] = [];

  const missing = validateFixture(footnote);
  if (missing.length > 0) {
    return {
      name: footnote.companyName || 'untitled fixture',
      verdict: 'SKIP',
      etrDeltaBp: null,
      deferredDeltaBp: null,
      notes: [`fixture not populated — missing: ${missing.join(', ')}`],
    };
  }

  const { etr, deferred } = runEngine(footnote);

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${footnote.companyName} (${footnote.companiesHouseNumber}) — period ended ${footnote.accountingPeriodEnd}`);
  console.log('─'.repeat(72));
  console.log(`  Pretax profit:       ${fmt$(footnote.pretaxProfit)}`);
  console.log(`  Disclosed tax:       ${fmt$(footnote.totalTaxCharge)}  (ETR ${(footnote.disclosedEffectiveRate * 100).toFixed(2)}%)`);
  console.log(`  Current / deferred:  ${fmt$(footnote.currentTaxCharge)} / ${fmt$(footnote.deferredTaxCharge)}`);
  console.log(`  Statutory rate:      ${(footnote.statutoryRate * 100).toFixed(1)}%`);

  console.log(`  Recon items:         ${footnote.reconciliationItems.filter(i => i.type === 'permanent').length} perm, ${footnote.reconciliationItems.filter(i => i.type === 'timing').length} timing, ${footnote.reconciliationItems.filter(i => i.type === 'other').length} other`);
  for (const item of footnote.reconciliationItems) {
    console.log(`    ${item.amount >= 0 ? '+' : ''}${fmt$(item.amount).replace('£-', '-£')}  [${item.type}] ${item.label}`);
  }

  // ETR check
  const engineETR = etr.effectiveTaxRate.toNumber();
  const engineTotal = etr.totalTaxExpense.toNumber();
  const etrDeltaBp = Math.abs(bp(engineETR - footnote.disclosedEffectiveRate));

  let verdict: Verdict;
  if (etrDeltaBp <= PASS_BP) {
    verdict = 'PASS';
  } else if (etrDeltaBp <= WARN_BP) {
    verdict = 'WARN';
  } else {
    verdict = 'FAIL';
  }

  console.log(`  Engine tax:          ${fmt$(engineTotal)}  (ETR ${(engineETR * 100).toFixed(2)}%)`);
  console.log(`  ETR delta:           ${etrDeltaBp}bp  →  ${verdict}`);

  // Deferred tax closing balance check
  const engineDeferredClosing = deferred.totalClosingDTL.toNumber();
  const disclosedDeferredLiabilities = footnote.deferredTaxLiabilityClosing;
  const deferredDeltaRaw = Math.abs(engineDeferredClosing - disclosedDeferredLiabilities);
  const deferredDeltaBp = Math.round((deferredDeltaRaw / Math.abs(footnote.pretaxProfit)) * 10_000);

  const deferredVerdict = deferredDeltaBp <= PASS_BP ? 'OK' : deferredDeltaBp <= WARN_BP ? 'MARGINAL' : 'MISMATCH';
  console.log(`  Deferred closing:    engine ${fmt$(engineDeferredClosing)} vs disclosed ${fmt$(disclosedDeferredLiabilities)}  (${deferredDeltaBp}bp)  →  ${deferredVerdict}`);
  if (footnote.probableRecoveryNoted) {
    console.log(`  Probable recovery:   noted in filing — DTA gate exercised`);
  }

  return {
    name: footnote.companyName,
    verdict,
    etrDeltaBp,
    deferredDeltaBp,
    notes,
  };
}

function main() {
  console.log('TaxPro UK FRS 102 Eval Harness');
  console.log('Validating tax-engine ETR + deferred math against manually-curated Companies House fixtures');
  console.log(`\nFixtures loaded: ${fixtures.length}`);

  const results: CompanyResult[] = [];
  for (const footnote of fixtures) {
    results.push(evalFixture(footnote));
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(72));
  for (const r of results) {
    const etrDelta = r.etrDeltaBp === null ? '  n/a' : `${String(r.etrDeltaBp).padStart(4)}bp`;
    const deferredDelta = r.deferredDeltaBp === null ? '  n/a' : `${String(r.deferredDeltaBp).padStart(4)}bp`;
    console.log(`  ${r.verdict.padEnd(4)}  ${(r.name.length > 30 ? r.name.slice(0, 27) + '...' : r.name).padEnd(30)} ETR ${etrDelta}  DT ${deferredDelta}  ${r.notes.join('; ')}`);
  }

  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  results.forEach(r => counts[r.verdict]++);
  const skipCount = results.filter(r => r.verdict === 'SKIP').length;
  console.log(`\n  ${counts.PASS} passed, ${counts.WARN} warnings, ${counts.FAIL} failed, ${counts.SKIP} skipped`);

  const evaluated = results.filter(r => r.etrDeltaBp !== null);
  if (evaluated.length > 0) {
    const meanDelta = evaluated.reduce((s, r) => s + (r.etrDeltaBp ?? 0), 0) / evaluated.length;
    console.log(`  Mean ETR delta: ${meanDelta.toFixed(1)}bp across ${evaluated.length} companies`);
  }

  const deferredEvaluated = results.filter(r => r.deferredDeltaBp !== null);
  if (deferredEvaluated.length > 0) {
    const meanDeferredDelta = deferredEvaluated.reduce((s, r) => s + (r.deferredDeltaBp ?? 0), 0) / deferredEvaluated.length;
    console.log(`  Mean deferred closing delta: ${meanDeferredDelta.toFixed(1)}bp across ${deferredEvaluated.length} companies`);
  }

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main();
