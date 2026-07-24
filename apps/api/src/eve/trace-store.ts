import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { aiRuns, aiSteps } from '../db/schema/ai-runs.js';
import type { EveRunContext } from './types.js';
import { stableHash } from './hash.js';

export async function startAiRun(
  context: EveRunContext,
  input: unknown,
  meta: { provider?: string; model?: string } = {},
) {
  const [run] = await db.insert(aiRuns).values({
    tenantId: context.tenantId,
    userId: context.userId,
    provisionRunId: context.provisionRunId,
    workflowName: context.workflowName,
    provider: meta.provider,
    model: meta.model,
    promptVersion: context.promptVersion ?? 'unversioned',
    inputHash: stableHash(input),
    inputSummary: summarizeInput(input),
    status: 'started',
  }).returning();

  return run;
}

export async function completeAiRun(id: string, output: unknown) {
  await db.update(aiRuns).set({
    status: 'completed',
    outputJson: output,
    completedAt: new Date(),
  }).where(eq(aiRuns.id, id));
}

export async function failAiRun(id: string, error: unknown) {
  await db.update(aiRuns).set({
    status: 'failed',
    errorMessage: error instanceof Error ? error.message : String(error),
    completedAt: new Date(),
  }).where(eq(aiRuns.id, id));
}

export async function recordAiStep(aiRunId: string, sequence: number, stepName: string, input: unknown, output: unknown) {
  await db.insert(aiSteps).values({
    aiRunId,
    sequence,
    stepName,
    status: 'completed',
    inputJson: input,
    outputJson: output,
    completedAt: new Date(),
  });
}

function summarizeInput(input: unknown) {
  if (!input || typeof input !== 'object') return { valueType: typeof input };
  if (Array.isArray(input)) return { valueType: 'array', count: input.length };

  const record = input as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    if (Array.isArray(value)) return [key, { type: 'array', count: value.length }];
    if (value && typeof value === 'object') return [key, { type: 'object', keys: Object.keys(value as Record<string, unknown>).length }];
    return [key, value];
  }));
}
