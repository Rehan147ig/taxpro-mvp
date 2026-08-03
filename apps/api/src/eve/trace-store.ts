import { eq } from 'drizzle-orm';
import { db } from '../config/db.js';
import { aiRuns, aiSteps } from '../db/schema/ai-runs.js';
import { provisionEvents } from '../db/schema/provision-events.js';
import type { EveRunContext } from './types.js';
import { stableHash } from './hash.js';

function resolve(tx?: any) {
  return tx ?? db;
}

export async function startAiRun(
  tx: any,
  context: EveRunContext,
  input: unknown,
  meta: { provider?: string; model?: string } = {},
) {
  const d = resolve(tx);

  const [run] = await d.insert(aiRuns).values({
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
    agentName: context.workflowName,
  }).returning();

  await d.insert(provisionEvents).values({
    tenantId: context.tenantId,
    provisionRunId: context.provisionRunId ?? '',
    eventType: 'ai.workflow.started',
    actorType: 'agent',
    actorAgentId: run.id,
    actorUserId: context.userId,
    occurredAt: new Date(),
    reason: `AI workflow ${context.workflowName} started`,
    metadata: JSON.stringify({ workflowName: context.workflowName, promptVersion: context.promptVersion }),
  }).catch(() => {});

  return run;
}

type AiRunStatus = 'started' | 'completed' | 'failed' | 'timeout' | 'fallback_used';

async function updateAiRunStatus(
  id: string,
  status: AiRunStatus,
  eventType: string,
  reason: string,
  extra: { errorMessage?: string; outputJson?: unknown } = {},
  tx?: any,
) {
  const d = resolve(tx);
  await d.update(aiRuns).set({
    status,
    ...(extra.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
    ...(extra.outputJson !== undefined ? { outputJson: extra.outputJson } : {}),
    completedAt: new Date(),
  }).where(eq(aiRuns.id, id));

  const [run] = await d.select({
    tenantId: aiRuns.tenantId,
    provisionRunId: aiRuns.provisionRunId,
    workflowName: aiRuns.workflowName,
  }).from(aiRuns).where(eq(aiRuns.id, id)).limit(1);
  if (run && run.provisionRunId) {
    // Awaited (with best-effort semantics preserved): the event must be
    // visible to callers as soon as the status update is — fire-and-forget
    // here races the caller's read and loses the event on slow CI.
    await d.insert(provisionEvents).values({
      tenantId: run.tenantId,
      provisionRunId: run.provisionRunId,
      eventType,
      actorType: 'agent',
      actorAgentId: id,
      occurredAt: new Date(),
      reason,
    }).catch(() => {});
  }
}

export async function completeAiRun(id: string, output: unknown, tx?: any) {
  await updateAiRunStatus(
    id,
    'completed',
    'ai.workflow.completed',
    'AI workflow completed',
    { outputJson: output },
    tx,
  );
}

export async function failAiRun(id: string, error: unknown, tx?: any) {
  const message = error instanceof Error ? error.message : String(error);
  await updateAiRunStatus(
    id,
    'failed',
    'ai.workflow.failed',
    `AI workflow failed: ${message}`,
    { errorMessage: message },
    tx,
  );
}

export async function timeoutAiRun(id: string, error: unknown, tx?: any) {
  const message = error instanceof Error ? error.message : String(error);
  await updateAiRunStatus(
    id,
    'timeout',
    'ai.workflow.timed_out',
    `AI workflow timed out: ${message}`,
    { errorMessage: message },
    tx,
  );
}

export async function fallbackAiRun(id: string, reason: string, tx?: any) {
  await updateAiRunStatus(
    id,
    'fallback_used',
    'ai.workflow.fallback_used',
    `AI workflow completed via deterministic fallback: ${reason}`,
    { errorMessage: reason },
    tx,
  );
}

export async function recordAiStep(aiRunId: string, sequence: number, stepName: string, input: unknown, output: unknown, tx?: any) {
  const d = resolve(tx);
  await d.insert(aiSteps).values({
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
