/**
 * UK FRS 102 Pilot — End-to-End Pipeline Test
 *
 * Reads a synthetic UK trial balance CSV, runs the full agent pipeline
 * (parse → map → calculate → explain → audit) under UK_FRS102_S29
 * jurisdiction, and validates the output.
 *
 * Usage:
 *   npx tsx scripts/test-uk-pilot.ts
 *
 * Environment:
 *   INTERFAZE_API_KEY (or AI_API_KEY) must be set in .env
 *   AI_PROVIDER=interfaze (or the provider of your choice)
 */

import fs from 'fs';
import path from 'path';
import { parseTrialBalance } from '../../agent/parser/parser-agent.js';
import { classifyAccounts } from '../../agent/mapping/mapping-agent.js';
import { generateExplanation } from '../../agent/explanation/explanation-agent.js';
import { auditProvision } from '../../agent/audit/audit-agent.js';
import { calculateCurrentTax } from '../../packages/tax-engine/src/current-tax.js';
import { calculateDeferredTax } from '../../packages/tax-engine/src/deferred-tax.js';
import { calculateETR } from '../../packages/tax-engine/src/etr-reconciliation.js';
import Decimal from 'decimal.js';
import { assertNotLocked, transitionStage } from '../src/state/tax-provision-state.js';
import type { TaxProvisionState } from '../src/state/tax-provision-state.js';
import type { Jurisdiction } from '../../packages/tax-engine/src/types.js';

const JURISDICTION = 'UK_FRS102_S29' as Jurisdiction;
const UK_TAX_RATE = 0.25;

interface TestResult {
  step: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function runStep(name: string, fn: () => Promise<any>, expected?: (val: any) => void) {
  try {
    const val = await fn();
    if (expected) expected(val);
    results.push({ step: name, passed: true });
    console.log(`  ✅ ${name}`);
    return val;
  } catch (err: any) {
    results.push({ step: name, passed: false, detail: err.message });
    console.error(`  ❌ ${name}: ${err.message}`);
    throw err;
  }
}

function createInitialState(): TaxProvisionState {
  return {
    jobId: 'uk-pilot-test',
    jurisdiction: JURISDICTION,
    stage: 'parse',
    parsedItems: [],
    mappedItems: [],
    engineOutput: null,
    explanations: [],
    auditFlags: [],
    humanReview: 'pending',
    locked: false,
  };
}

async function main() {
  console.log(`\n🇬🇧 UK FRS 102 Section 29 — Pilot Pipeline Test\n`);
  console.log(`Jurisdiction: ${JURISDICTION}`);
  console.log(`Tax rate: ${(UK_TAX_RATE * 100)}%\n`);

  // ── Step 1: Read CSV ──
  const csvPath = path.resolve(process.cwd(), 'scripts/uk-trial-balance.csv');
  let rawCsv = '';
  await runStep('1. Read UK TB CSV', async () => {
    rawCsv = fs.readFileSync(csvPath, 'utf-8');
    assert(rawCsv.length > 0, 'CSV file is empty');
    const lines = rawCsv.trim().split('\n');
    assert(lines.length > 1, 'CSV has no data rows');
    return `Read ${lines.length - 1} rows from ${csvPath}`;
  });

  let state = createInitialState();
  state.rawInput = rawCsv;

  // ── Step 2: Parse ──
  await runStep('2. Parse Trial Balance', async () => {
    state = transitionStage(state, 'parse', ['parse']);
    const parseResult = await parseTrialBalance(rawCsv, 'csv');
    state.parsedItems = parseResult.items;
    assert(state.parsedItems.length > 0, 'No items parsed');
    assert(state.parsedItems[0].accountNumber, 'Missing accountNumber in parsed item');
    return `Parsed ${state.parsedItems.length} items (source: ${parseResult.source})`;
  });

  // ── Step 3: Map ──
  await runStep('3. Classify Accounts (UK FRS 102)', async () => {
    state = transitionStage(state, 'map', ['parse']);
    state.mappedItems = await classifyAccounts(
      state.parsedItems.map(p => ({
        accountNumber: p.accountNumber,
        accountName: p.accountName,
        accountType: p.accountType,
        debit: p.debit,
        credit: p.credit,
        balance: p.balance,
      })),
      JURISDICTION,
    );
    assert(state.mappedItems.length > 0, 'No items mapped');
    const ukTiming = state.mappedItems.filter(m => m.timingCategory);
    return `Mapped ${state.mappedItems.length} items (${ukTiming.length} with timing differences)`;
  });

  // ── Step 4: Calculate ──
  await runStep('4. Calculate Provision (UK rates)', async () => {
    state = transitionStage(state, 'calculate', ['map']);

    const bookIncome = state.parsedItems
      .filter(p => p.accountType === 'Income' || p.accountType === 'Expense')
      .reduce((sum, p) => sum.add(new Decimal(p.balance)), new Decimal(0));

    const currentTax = calculateCurrentTax({
      bookIncome,
      permanentDifferences: [],
      taxRate: new Decimal(UK_TAX_RATE),
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: '2026-06-30',
    });

    const deferredTax = calculateDeferredTax(
      state.mappedItems
        .filter(m => m.bookTreatment === 'temporary')
        .map(m => ({
          accountNumber: m.accountNumber,
          timingCategory: m.timingCategory || 'other',
          bookBasis: new Decimal(0),
          taxBasis: new Decimal(0),
          difference: new Decimal(0),
          reversalPeriod: '2027-06-30',
        })),
      {},
      {},
      { 'other': false },
      JURISDICTION,
    );

    const etr = calculateETR({
      bookIncome: currentTax.bookIncome,
      federalTaxRate: currentTax.federalTaxRate,
      federalTax: currentTax.federalTax,
      stateTax: currentTax.stateTax,
      permanentDifferences: [],
      taxCredits: currentTax.taxCredits,
      otherAdjustments: [],
    });

    state.engineOutput = { currentTax, deferredTax, etr };
    assert(state.engineOutput.currentTax !== null, 'Missing currentTax');
    assert(state.engineOutput.deferredTax !== null, 'Missing deferredTax');
    return `Current tax: ${currentTax.federalTax.toString()}, Deferred lines: ${deferredTax.lines.length}, ETR: ${(Number(etr.effectiveTaxRate) * 100).toFixed(2)}%`;
  });

  // ── Step 5: Explain ──
  await runStep('5. Generate Explanations (FRS 102 Section 29)', async () => {
    state = transitionStage(state, 'explain', ['calculate']);
    const output = state.engineOutput!;
    state.explanations = await generateExplanation({
      bookIncome: output.currentTax.bookIncome.toString(),
      currentTax: output.currentTax as any,
      deferredTax: output.deferredTax as any,
      etr: output.etr as any,
      jurisdiction: JURISDICTION,
      jurisdictionRules: 'FRS 102 Section 29: no discounting, probable recovery required, debtors/provisions presentation',
    });
    assert(state.explanations.length > 0, 'No explanations generated');
    const hasFrsCitation = state.explanations.some(e =>
      e.citations?.some(c => c.rule?.includes('FRS 102') || c.reference?.includes('FRS 102'))
    );
    return `Generated ${state.explanations.length} explanation(s)${hasFrsCitation ? ' (with FRS 102 citations)' : ''}`;
  });

  // ── Step 6: Audit ──
  await runStep('6. Audit Provision', async () => {
    state = transitionStage(state, 'audit', ['explain']);
    const output = state.engineOutput!;
    state.auditFlags = await auditProvision({
      bookIncome: output.currentTax.bookIncome.toString(),
      disclosedETR: output.etr.effectiveTaxRate.toString(),
      computedETR: output.etr.effectiveTaxRate.toString(),
      deferredTaxLines: output.deferredTax.lines as any,
      permanentDifferences: [],
      jurisdiction: JURISDICTION,
    });
    return `Generated ${state.auditFlags.length} audit flag(s) — ` +
      state.auditFlags.map(f => `[${f.severity}] ${f.category}: ${f.description}`).join('; ');
  });

  // ── Summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🇬🇧 UK FRS 102 Pilot — ${passed}/${results.length} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) {
    console.error('Failed steps:');
    results.filter(r => !r.passed).forEach(r => console.error(`  - ${r.step}: ${r.detail}`));
    process.exit(1);
  }

  // Write results summary
  const summaryPath = path.resolve(process.cwd(), 'scripts/uk-pilot-results.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    jurisdiction: JURISDICTION,
    timestamp: new Date().toISOString(),
    passed,
    failed,
    total: results.length,
    steps: results,
    engineOutput: {
      currentTax: state.engineOutput?.currentTax,
      deferredLines: state.engineOutput?.deferredTax?.lines?.length ?? 0,
      etr: state.engineOutput?.etr?.effectiveTaxRate,
    },
    mappedCount: state.mappedItems.length,
    explanationCount: state.explanations.length,
    auditFlagCount: state.auditFlags.length,
  }, null, 2));
  console.log(`Results written to ${summaryPath}`);
}

main().catch((err) => {
  console.error('\n❌ UK Pilot Test Failed:', err);
  process.exit(1);
});
