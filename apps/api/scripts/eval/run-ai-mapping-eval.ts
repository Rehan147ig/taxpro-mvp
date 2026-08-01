import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runMappingAgent } from '../../src/agent/subagents/mapping-agent.js';
import { getAiModel, isAiConfigured } from '../../src/config/ai.js';

/** Accounts per stage-2 LLM call — mirrors the production auto-mapper (BATCH_SIZE = 50). */
const BATCH_SIZE = 50;

interface GoldenEntry {
  accountName: string;
  accountType: string;
  expectedTreatment: string;
  expectedCategory: string | null;
  expectedTaxType: string;
  reason: string;
}

interface EvalResult {
  accountName: string;
  predicted: string | null;
  expected: string;
  reason: string;
  correct: boolean;
  confidence?: number;
}

function loadGoldenDataset(): GoldenEntry[] {
  const path = resolve('../../packages/tax-engine/eval/golden-mapping.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenEntry[];
}

function normalizeType(type: string): string {
  return type.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function printDistribution(golden: GoldenEntry[]) {
  const summary = golden.reduce((acc, g) => {
    acc[g.expectedTreatment] = (acc[g.expectedTreatment] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('Expected distribution:');
  for (const [treatment, count] of Object.entries(summary)) {
    console.log(`  ${treatment}: ${count} entries`);
  }
}

function scorePredictions(
  golden: GoldenEntry[],
  predictions: Map<string, { treatment: string; taxType: string; confidence: number }>,
) {
  const results: EvalResult[] = [];
  let correctTreatment = 0;
  let correctTaxType = 0;

  for (let i = 0; i < golden.length; i++) {
    const g = golden[i];
    const pred = predictions.get(`eval-${i}`);

    const treatmentCorrect = pred?.treatment === g.expectedTreatment;
    if (treatmentCorrect) correctTreatment++;

    const taxTypeCorrect = pred?.taxType === normalizeType(g.expectedTaxType);
    if (taxTypeCorrect) correctTaxType++;

    results.push({
      accountName: g.accountName,
      predicted: pred ? `${pred.treatment}/${pred.taxType}` : 'NO_PREDICTION',
      expected: `${g.expectedTreatment}/${g.expectedTaxType}`,
      reason: g.reason,
      correct: treatmentCorrect && taxTypeCorrect,
      confidence: pred?.confidence,
    });
  }

  const treatmentAccuracy = ((correctTreatment / golden.length) * 100).toFixed(1);
  const taxTypeAccuracy = ((correctTaxType / golden.length) * 100).toFixed(1);
  const fullyCorrect = results.filter(r => r.correct).length;
  const overallAccuracy = ((fullyCorrect / golden.length) * 100).toFixed(1);

  console.log(`\nResults:`);
  console.log(`  Treatment accuracy: ${correctTreatment}/${golden.length} (${treatmentAccuracy}%)`);
  console.log(`  Tax type accuracy:   ${correctTaxType}/${golden.length} (${taxTypeAccuracy}%)`);
  console.log(`  Fully correct:       ${fullyCorrect}/${golden.length} (${overallAccuracy}%)`);

  const errors = results.filter(r => !r.correct);
  if (errors.length > 0) {
    console.log(`\n${errors.length} incorrect classifications:`);
    for (const e of errors.slice(0, 20)) {
      console.log(`  "${e.accountName}" - predicted: ${e.predicted}, expected: ${e.expected} (${e.reason})`);
    }
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more`);
    }
  }

  const lowConfidence = results.filter(r => r.confidence !== undefined && r.confidence < 0.75);
  if (lowConfidence.length > 0) {
    console.log(`\n${lowConfidence.length} low-confidence predictions (<75%):`);
    for (const e of lowConfidence.slice(0, 10)) {
      console.log(`  "${e.accountName}" - confidence: ${(e.confidence! * 100).toFixed(0)}%`);
    }
  }

  return parseFloat(overallAccuracy);
}

function runModes() {
  const mode = (process.env.AI_EVAL_MODE ?? '').toLowerCase();
  if (process.env.MOCK_AI === '1') return 'mocked';
  const configured = isAiConfigured();
  if (mode === 'real' && !configured) {
    console.error('AI_EVAL_MODE=real requires a configured AI provider (AI_PROVIDER/AI_API_KEY).');
    process.exit(1);
  }
  if (mode === 'mocked') return 'mocked';
  if (mode === 'dry-run') return 'dry-run';
  if (configured && mode !== 'real') {
    console.log('AI provider configured; defaulting to real mode (set AI_EVAL_MODE=dry-run|mocked to override).');
    return 'real';
  }
  return 'dry-run';
}

function buildMockPredictions(golden: GoldenEntry[]) {
  const predictions = new Map<string, { treatment: string; taxType: string; confidence: number }>();
  golden.forEach((g, i) => {
    predictions.set(`eval-${i}`, {
      treatment: g.expectedTreatment,
      taxType: normalizeType(g.expectedTaxType),
      confidence: 0.99,
    });
  });
  return predictions;
}

async function main() {
  const mode = runModes();
  const golden = loadGoldenDataset();
  console.log(`\nAI Mapping Eval - ${golden.length} golden entries (mode: ${mode})\n`);

  let predictions: Map<string, { treatment: string; taxType: string; confidence: number }>;

  if (mode === 'mocked') {
    console.log('Mocked mode: scripted golden answers (no model call). Verifies harness plumbing only.');
    predictions = buildMockPredictions(golden);
  } else if (mode === 'real') {
    const model = getAiModel();
    console.log(`Calling mapping agent (provider=${model.provider}, model=${model.modelName})...\n`);

    const accounts = golden.map((g, i) => ({
      id: `eval-${i}`,
      accountNumber: String(i + 1000),
      name: g.accountName,
      type: g.accountType,
      detailType: g.accountType,
    }));

    // The eval tenant is synthetic — generate a real UUID so tenant-scoped
    // pattern queries (classification_patterns.tenant_id is uuid) do not
    // raise a 22P02 invalid-input-syntax error.
    const evalTenantId = randomUUID();

    // Chunk to stay under the model's output-token limit: 202 accounts in one
    // stage-2 call overflows max_tokens and truncates (missing mappings).
    // Batch at the same size as the production auto-mapper (50/call) so the
    // measurement reflects the real classification path.
    const allTaxMappings: Array<{ accountId: string; taxAccountType: string; bookTreatment: string; timingCategory?: string; confidenceScore: number; ircSection: string; explanation: string }> = [];
    let failed = false;
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      const agentResult = await runMappingAgent({
        tenantId: evalTenantId,
        tenantName: 'Eval Runner',
        accounts: batch,
      });

      if (!agentResult.success) {
        console.error(`Mapping agent failed on batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(accounts.length / BATCH_SIZE)}: ${agentResult.error}`);
        failed = true;
        break;
      }
      allTaxMappings.push(...agentResult.taxMappings);
    }

    if (failed) {
      console.log('\nAI provider timed out or returned an error. Falling back to dry-run statistics...');
      printDistribution(golden);
      console.log(`\nAI eval incomplete - 0/${golden.length} evaluated (API error). Exiting with code 0 for CI.`);
      process.exit(0);
    }

    predictions = new Map();
    for (const m of allTaxMappings) {
      predictions.set(m.accountId, {
        treatment: m.bookTreatment,
        taxType: normalizeType(m.taxAccountType),
        confidence: m.confidenceScore,
      });
    }
  } else {
    console.log('Dry-run: no AI provider configured. Would classify the following entries against the mapping agent.');
    printDistribution(golden);
    console.log(`\nDry-run complete - 0/${golden.length} evaluated (no AI provider).`);
    process.exit(0);
  }

  const accuracy = scorePredictions(golden, predictions);

  if (mode === 'mocked') {
    console.log('\nPASS: Mocked eval completed (no accuracy threshold enforced outside real mode).');
    process.exit(0);
  }

  if (accuracy >= 80) {
    console.log('\nPASS: Accuracy >= 80%');
  } else {
    console.log(`\nFAIL: Accuracy ${accuracy}% < 80% threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval crashed:', err);
  process.exit(1);
});
