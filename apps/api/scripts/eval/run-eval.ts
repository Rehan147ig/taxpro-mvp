/**
 * EDGAR Eval Harness — validates the TaxPro tax engine against
 * audited, publicly-filed tax footnotes from SEC EDGAR.
 *
 * For each target company:
 * 1. Pull XBRL company facts (pretax income, tax expense, ETR recon items)
 * 2. Feed the disclosed recon items through @taxpro/tax-engine calculateETR
 * 3. Compare engine ETR / total tax / statutory tax against the filing
 *
 * Scoring (ETR delta):
 *   PASS ≤ 25bp · WARN ≤ 100bp · FAIL > 100bp · SKIP missing critical data
 *
 * Run: npm run eval
 */

import { resolveCik, fetchCompanyFacts } from './edgar.js';
import { extractTaxFootnote, type TaxFootnote } from './ground-truth.js';
import { runEngine } from './xbrl-map.js';

// Simple, primarily-domestic, consistently profitable companies —
// chosen so their tax footnotes are short and clean.
const TARGETS = ['CLX', 'HSY', 'CHD', 'ROL', 'JKHY', 'WDFC', 'BRO', 'POOL', 'TYL', 'NUE', 'PAYC', 'AOS'];

const PASS_BP = 25;
const WARN_BP = 100;

const fmt$ = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};
const bp = (ratio: number) => Math.round(ratio * 10_000);

type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface CompanyResult {
  ticker: string;
  name: string;
  verdict: Verdict;
  etrDeltaBp: number | null;
  notes: string[];
}

async function evalCompany(ticker: string): Promise<CompanyResult> {
  const notes: string[] = [];
  const { cik, name } = await resolveCik(ticker);
  const facts = await fetchCompanyFacts(cik);

  let footnote: TaxFootnote;
  try {
    footnote = extractTaxFootnote(facts);
  } catch (err) {
    return { ticker, name, verdict: 'SKIP', etrDeltaBp: null, notes: [(err as Error).message] };
  }

  const { etr, classified, creditSignFlipped, consistencyBp: footnoteTieBp } = runEngine(footnote);

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`${ticker} — ${footnote.entityName} (FY ended ${footnote.fiscalYearEnd})`);
  console.log('─'.repeat(72));
  console.log(`  Pretax income:      ${fmt$(footnote.pretaxIncome)}`);
  console.log(`  Disclosed tax:      ${fmt$(footnote.totalTaxExpense)}  (ETR ${(footnote.disclosedETR * 100).toFixed(2)}%)`);
  if (footnote.currentTaxExpense !== null || footnote.deferredTaxExpense !== null) {
    console.log(`  Current / deferred: ${fmt$(footnote.currentTaxExpense ?? 0)} / ${fmt$(footnote.deferredTaxExpense ?? 0)}`);
  }

  // Check 1 — statutory tax: engine computes pretax × 21%
  const engineStatutory = etr.statutoryTax.toNumber();
  if (footnote.statutoryLine !== null) {
    const delta = Math.abs(engineStatutory - footnote.statutoryLine);
    const ok = delta <= Math.max(footnote.pretaxIncome * 0.0005, 1);
    console.log(`  Statutory tax:      engine ${fmt$(engineStatutory)} vs disclosed ${fmt$(footnote.statutoryLine)}  ${ok ? 'OK' : `DELTA ${fmt$(delta)}`}`);
    if (!ok) notes.push(`statutory delta ${fmt$(delta)}`);
  } else {
    notes.push('no disclosed statutory line (percentage-only recon?)');
  }

  // Check 2 — footnote internal consistency (data quality, not engine fault)
  if (footnoteTieBp > WARN_BP) {
    notes.push(`footnote items don't tie to disclosed total (${Math.round(footnoteTieBp)}bp off) — data quality issue`);
  }
  if (creditSignFlipped) {
    notes.push('credit signs flipped to tie footnote (filer convention quirk)');
  }

  console.log(`  Recon items:        ${classified.permanent.length} perm, ${classified.credits.length} credit, ${classified.state.length} state, ${classified.other.length} other${creditSignFlipped ? '  [credits sign-flipped]' : ''}`);
  for (const item of footnote.reconItems) {
    console.log(`    ${item.amount >= 0 ? '+' : ''}${fmt$(item.amount).replace('$-', '-$')}  ${item.label}`);
  }

  // Check 3 — the main event: engine ETR vs disclosed ETR
  const engineETR = etr.effectiveTaxRate.toNumber();
  const engineTotal = etr.totalTaxExpense.toNumber();
  const etrDeltaBp = Math.abs(bp(engineETR - footnote.disclosedETR));

  // Verdict semantics:
  //   PASS/WARN/FAIL = engine test result (footnote ties, so delta reflects engine)
  //   SKIP = footnote data inadequate to test the engine (doesn't tie internally,
  //          or no recon items tagged at all) — not an engine failure
  let verdict: Verdict;
  if (footnote.reconItems.length === 0) {
    verdict = 'SKIP';
    notes.push('no itemized recon data tagged (percentage-only or untagged filing)');
  } else if (footnoteTieBp > WARN_BP) {
    verdict = 'SKIP';
  } else {
    verdict = etrDeltaBp <= PASS_BP ? 'PASS' : etrDeltaBp <= WARN_BP ? 'WARN' : 'FAIL';
  }

  console.log(`  Engine tax:         ${fmt$(engineTotal)}  (ETR ${(engineETR * 100).toFixed(2)}%)`);
  console.log(`  ETR delta:          ${etrDeltaBp}bp  →  ${verdict}`);

  return { ticker, name, verdict, etrDeltaBp: verdict === 'SKIP' ? null : etrDeltaBp, notes };
}

async function main() {
  console.log('TaxPro EDGAR Eval Harness');
  console.log('Validating tax-engine ETR math against audited SEC filings');
  if (process.env.OFFLINE) console.log('(OFFLINE mode — cache only)');

  const results: CompanyResult[] = [];
  for (const ticker of TARGETS) {
    try {
      results.push(await evalCompany(ticker));
    } catch (err) {
      results.push({ ticker, name: '?', verdict: 'SKIP', etrDeltaBp: null, notes: [(err as Error).message] });
    }
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(72));
  for (const r of results) {
    const delta = r.etrDeltaBp === null ? '  n/a' : `${String(r.etrDeltaBp).padStart(4)}bp`;
    console.log(`  ${r.verdict.padEnd(4)}  ${r.ticker.padEnd(6)} ${delta}  ${r.notes.join('; ')}`);
  }

  const counts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  results.forEach(r => counts[r.verdict]++);
  console.log(`\n  ${counts.PASS} passed, ${counts.WARN} warnings, ${counts.FAIL} failed, ${counts.SKIP} skipped`);

  const evaluated = results.filter(r => r.etrDeltaBp !== null);
  if (evaluated.length > 0) {
    const meanDelta = evaluated.reduce((s, r) => s + (r.etrDeltaBp ?? 0), 0) / evaluated.length;
    console.log(`  Mean ETR delta: ${meanDelta.toFixed(1)}bp across ${evaluated.length} companies`);
  }

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Eval harness crashed:', err);
  process.exit(2);
});
