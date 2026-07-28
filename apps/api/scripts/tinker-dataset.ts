/**
 * Tinker Dataset Export — Agent Trace → JSONL for Fine-Tuning
 *
 * Reads agent traces from the database and exports JSONL files, one per
 * agent stage (parse, map, explain, audit), suitable for OpenAI / Vercel
 * SDK fine-tuning.
 *
 * Each JSONL line contains an {"input": ..., "output": ...} pair with
 * jurisdiction metadata so the fine-tuned model can be jurisdiction-aware.
 *
 * Usage:
 *   npx tsx scripts/tinker-dataset.ts [--stage parse|map|explain|audit] [--tenant <slug>]
 *
 * Examples:
 *   npx tsx scripts/tinker-dataset.ts                          # all stages, all tenants
 *   npx tsx scripts/tinker-dataset.ts --stage map --limit 100  # map only, max 100 records
 */

import fs from 'fs';
import path from 'path';
import { db } from '../src/config/db.js';
import { trialBalance } from '../src/db/schema/trial-balance.js';
import { taxMappings } from '../src/db/schema/tax-mappings.js';
import { provisionResults } from '../src/db/schema/provision-results.js';
import { aiRuns } from '../src/db/schema/ai-runs.js';
import { aiSteps } from '../src/db/schema/ai-runs.js';
import { accounts } from '../src/db/schema/accounts.js';
import { entities } from '../src/db/schema/entities.js';
import { tenants } from '../src/db/schema/tenants.js';
import { eq, and, sql } from 'drizzle-orm';

// ── CLI args ──

const args = process.argv.slice(2);
const targetStage = parseArg('--stage') as string | undefined;
const tenantSlug = parseArg('--tenant') as string | undefined;
const limit = Number(parseArg('--limit') ?? '500');

const OUT_DIR = path.resolve(process.cwd(), 'tinker-datasets');
fs.mkdirSync(OUT_DIR, { recursive: true });

function parseArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── Helpers ──

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function dateKey(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

// ── Query builder ──

async function exportMappingData(tenantId?: string, maxRows = limit) {
  const conditions = [eq(taxMappings.suggestedByAi, true)];
  if (tenantId) conditions.push(eq(taxMappings.tenantId, tenantId));

  const rows = await db
    .select({
      accountNumber: accounts.accountNumber,
      accountName: accounts.name,
      accountType: accounts.type,
      mappingType: taxMappings.taxAccountType,
      bookTreatment: taxMappings.bookTreatment,
      timingCategory: taxMappings.timingCategory,
      confidenceScore: taxMappings.confidenceScore,
      aiExplanation: taxMappings.aiExplanation,
    })
    .from(taxMappings)
    .innerJoin(accounts, eq(taxMappings.accountId, accounts.id))
    .where(and(...conditions))
    .limit(maxRows);

  if (!rows.length) {
    console.log('No mapping data to export. Run the seed script first.');
    return;
  }

  const lines = rows.map((r) => JSON.stringify({
    input: `Classify account "${safeString(r.accountNumber)} - ${safeString(r.accountName)}" (type: ${safeString(r.accountType)}) into a tax category.`,
    output: JSON.stringify({
      taxAccountType: r.mappingType,
      bookTreatment: r.bookTreatment,
      timingCategory: r.timingCategory,
      confidenceScore: r.confidenceScore,
      rationale: r.aiExplanation,
    }),
    jurisdiction: 'US_ASC740',
    agent: 'mapping',
  }));

  const outPath = path.join(OUT_DIR, `mapping-${dateKey(new Date())}.jsonl`);
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Exported ${lines.length} mapping records → ${outPath}`);
}

async function exportProvisionData(tenantId?: string, maxRows = limit) {
  const conditions = [];
  if (tenantId) conditions.push(eq(provisionResults.tenantId, tenantId));

  const rows = await db
    .select({
      period: provisionResults.period,
      status: provisionResults.status,
      bookIncome: provisionResults.bookIncome,
      currentTaxExpense: provisionResults.currentTaxExpense,
      deferredTaxExpense: provisionResults.deferredTaxExpense,
      totalTaxExpense: provisionResults.totalTaxExpense,
      effectiveTaxRate: provisionResults.effectiveTaxRate,
      statutoryRate: provisionResults.statutoryRate,
      taxPayable: provisionResults.taxPayable,
      valuationAllowance: provisionResults.valuationAllowance,
    })
    .from(provisionResults)
    .where(and(...conditions))
    .limit(maxRows);

  if (!rows.length) {
    console.log('No provision data to export. Run a provision first.');
    return;
  }

  const lines = rows.map((r) => JSON.stringify({
    input: `Calculate tax provision for period ending ${dateKey(r.period)} with book income ${safeString(r.bookIncome)}.`,
    output: JSON.stringify({
      status: r.status,
      currentTaxExpense: r.currentTaxExpense,
      deferredTaxExpense: r.deferredTaxExpense,
      totalTaxExpense: r.totalTaxExpense,
      effectiveTaxRate: r.effectiveTaxRate,
      statutoryRate: r.statutoryRate,
      taxPayable: r.taxPayable,
      valuationAllowance: r.valuationAllowance,
    }),
    jurisdiction: 'US_ASC740',
    agent: 'calculation',
  }));

  const outPath = path.join(OUT_DIR, `provision-${dateKey(new Date())}.jsonl`);
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Exported ${lines.length} provision records → ${outPath}`);
}

async function exportTrialBalanceCsv(tenantId?: string) {
  const conditions = [];
  if (tenantId) conditions.push(eq(trialBalance.tenantId, tenantId));

  const rows = await db
    .select({
      accountNumber: accounts.accountNumber,
      accountName: accounts.name,
      accountType: accounts.type,
      period: trialBalance.period,
      debit: trialBalance.debit,
      credit: trialBalance.credit,
      balance: trialBalance.balance,
    })
    .from(trialBalance)
    .innerJoin(accounts, eq(trialBalance.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(trialBalance.period, accounts.accountNumber)
    .limit(limit);

  if (!rows.length) {
    console.log('No trial balance data to export.');
    return;
  }

  const csvLines = ['accountNumber,accountName,accountType,period,debit,credit,balance'];
  for (const r of rows) {
    csvLines.push(`${safeString(r.accountNumber)},${safeString(r.accountName)},${safeString(r.accountType)},${dateKey(r.period)},${safeString(r.debit)},${safeString(r.credit)},${safeString(r.balance)}`);
  }

  // Also write a JSONL version for the parser agent fine-tuning
  const jsonlLines = rows.map((r) => JSON.stringify({
    input: `Parse this trial balance row: ${safeString(r.accountNumber)}, ${safeString(r.accountName)}, ${safeString(r.accountType)}, ${dateKey(r.period)}, ${safeString(r.debit)}, ${safeString(r.credit)}, ${safeString(r.balance)}`,
    output: JSON.stringify({
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      accountType: r.accountType,
      period: dateKey(r.period),
      debit: safeString(r.debit),
      credit: safeString(r.credit),
      balance: safeString(r.balance),
    }),
    jurisdiction: 'US_ASC740',
    agent: 'parser',
  }));

  const csvPath = path.join(OUT_DIR, `trial-balance-${dateKey(new Date())}.csv`);
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n');
  console.log(`Exported ${rows.length} TB rows (CSV) → ${csvPath}`);

  const jsonlPath = path.join(OUT_DIR, `parser-${dateKey(new Date())}.jsonl`);
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n') + '\n');
  console.log(`Exported ${jsonlLines.length} parser records (JSONL) → ${jsonlPath}`);
}

async function exportAiRuns(tenantId?: string, stageFilter?: string, maxRows = limit) {
  const conditions = [];
  if (tenantId) conditions.push(eq(aiRuns.tenantId, tenantId));
  if (stageFilter && stageFilter !== 'calculate') {
    conditions.push(eq(aiRuns.workflowName, stageFilter));
  }

  const runs = await db
    .select({
      id: aiRuns.id,
      workflowName: aiRuns.workflowName,
      version: aiRuns.promptVersion,
      provider: aiRuns.provider,
      model: aiRuns.model,
      inputSummary: aiRuns.inputSummary,
      outputJson: aiRuns.outputJson,
      status: aiRuns.status,
      agentName: aiRuns.agentName,
    })
    .from(aiRuns)
    .where(and(...conditions))
    .orderBy(aiRuns.startedAt)
    .limit(maxRows);

  if (!runs.length) {
    console.log('No AI runs found. Run the pipeline first.');
    return;
  }

  const lines = runs.map((r) => JSON.stringify({
    input: r.inputSummary ? JSON.stringify(r.inputSummary) : '',
    output: r.outputJson ? JSON.stringify(r.outputJson) : '',
    jurisdiction: 'US_ASC740',
    agent: r.agentName || r.workflowName,
    model: `${r.provider ?? 'unknown'}/${r.model ?? 'unknown'}`,
    version: r.version,
  }));

  const agentType = stageFilter || 'all';
  const outPath = path.join(OUT_DIR, `ai-runs-${agentType}-${dateKey(new Date())}.jsonl`);
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Exported ${lines.length} AI run records (${agentType}) → ${outPath}`);

  // Also export step-level details if available
  const runIds = runs.map((r) => r.id);
  if (runIds.length > 0) {
    const steps = await db
      .select({
        runId: aiSteps.aiRunId,
        stepName: aiSteps.stepName,
        inputJson: aiSteps.inputJson,
        outputJson: aiSteps.outputJson,
        sequence: aiSteps.sequence,
      })
      .from(aiSteps)
      .where(sql`${aiSteps.aiRunId} = ANY(${runIds}::uuid[])`)
      .orderBy(aiSteps.sequence);

    if (steps.length > 0) {
      const stepLines = steps.map((s) => JSON.stringify({
        input: s.inputJson ? JSON.stringify(s.inputJson) : '',
        output: s.outputJson ? JSON.stringify(s.outputJson) : '',
        jurisdiction: 'US_ASC740',
        agent: `step:${s.stepName}`,
      }));
      const stepPath = path.join(OUT_DIR, `ai-steps-${dateKey(new Date())}.jsonl`);
      fs.writeFileSync(stepPath, stepLines.join('\n') + '\n');
      console.log(`Exported ${stepLines.length} AI step records → ${stepPath}`);
    }
  }
}

// ── Main ──

async function main() {
  let tenantId: string | undefined;
  if (tenantSlug) {
    const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, tenantSlug)).limit(1);
    if (!t) {
      console.error(`Tenant "${tenantSlug}" not found. Available: run without --tenant to see all.`);
      process.exit(1);
    }
    tenantId = t.id;
  }

  console.log(`\n🧪 Tinker Dataset Export`);
  console.log(`   Stage filter: ${targetStage ?? 'all'}`);
  console.log(`   Tenant: ${tenantSlug ?? 'all'}`);
  console.log(`   Max records: ${limit}\n`);

  // Export AI run traces (most accurate I/O pairs for fine-tuning)
  if (!targetStage || targetStage !== 'provision') {
    await exportAiRuns(tenantId, targetStage);
  }

  if (!targetStage || targetStage === 'parse') {
    await exportTrialBalanceCsv(tenantId);
  }
  if (!targetStage || targetStage === 'map') {
    await exportMappingData(tenantId);
  }
  if (!targetStage || targetStage === 'calculate' || targetStage === 'explain' || targetStage === 'audit') {
    await exportProvisionData(tenantId);
  }

  console.log(`\n✅ All exports written to ${OUT_DIR}`);
  console.log(`   Upload these JSONL files to the fine-tuning provider of your choice.`);
}

main().catch((err) => {
  console.error('[Tinker Dataset] Failed:', err);
  process.exit(1);
});
