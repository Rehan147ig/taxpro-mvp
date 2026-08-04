// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Workbench job ledger.
//
// Every import/calculation is recorded as a tenant-scoped job with an
// idempotency key (unique per tenant). Jobs execute inline within the request
// transaction in development/tests; the same handlers can be dispatched
// through BullMQ when WORKBENCH_ASYNC is enabled. A completed job is never
// re-executed: replaying an idempotency key returns the recorded outcome.
// On handler failure the whole transaction rolls back, so a failed attempt
// leaves no partial state and the idempotency key remains retryable.
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq } from 'drizzle-orm';
import { workbenchJobs } from '../../db/schema/workbench-jobs.js';
import { BadRequestError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const WORKBENCH_JOB_TYPES = {
  TRIAL_BALANCE_IMPORT: 'trial_balance_import',
  PROVISION_CALCULATION: 'provision_calculation',
  PROVISION_RECALCULATION: 'provision_recalculation',
} as const;

export type WorkbenchJobType = (typeof WORKBENCH_JOB_TYPES)[keyof typeof WORKBENCH_JOB_TYPES];

export type WorkbenchJobHandler = (
  tx: any,
  payload: any,
) => Promise<Record<string, unknown>>;

export async function createWorkbenchJob(tx: any, args: {
  tenantId: string;
  userId: string;
  jobType: WorkbenchJobType;
  idempotencyKey: string;
  payload: any;
  correlationId: string;
}): Promise<{ job: typeof workbenchJobs.$inferSelect; created: boolean }> {
  const [job] = await tx.insert(workbenchJobs).values({
    tenantId: args.tenantId,
    jobType: args.jobType,
    idempotencyKey: args.idempotencyKey,
    status: 'queued',
    payload: args.payload,
    correlationId: args.correlationId,
    createdByUserId: args.userId,
  }).onConflictDoNothing().returning();

  if (job) return { job, created: true };

  const [existing] = await tx.select().from(workbenchJobs)
    .where(and(
      eq(workbenchJobs.tenantId, args.tenantId),
      eq(workbenchJobs.idempotencyKey, args.idempotencyKey),
    )).limit(1);
  if (!existing) {
    throw new BadRequestError('Workbench job idempotency key conflict');
  }
  return { job: existing, created: false };
}

/**
 * Executes a job handler and records the outcome on the job row. Completed
 * jobs short-circuit (idempotent replay). On handler failure the error is
 * rethrown so the enclosing transaction rolls back: no partial state, and
 * the idempotency key stays retryable.
 */
export async function executeWorkbenchJob(
  tx: any,
  job: typeof workbenchJobs.$inferSelect,
  handler: WorkbenchJobHandler,
): Promise<Record<string, unknown>> {
  if (job.status === 'succeeded') {
    return (job.result as Record<string, unknown>) ?? {};
  }

  await tx.update(workbenchJobs).set({ status: 'running', startedAt: new Date() })
    .where(eq(workbenchJobs.id, job.id));

  const result = await handler(tx, (job.payload as Record<string, unknown>) ?? {});

  const runId = typeof result?.runId === 'string' ? result.runId : null;
  await tx.update(workbenchJobs).set({
    status: 'succeeded',
    result,
    completedAt: new Date(),
    ...(runId ? { provisionRunId: runId } : {}),
  }).where(eq(workbenchJobs.id, job.id));

  return result;
}

export function logJobFailure(jobType: string, jobId: string, err: unknown): void {
  logger.warn({ jobType, jobId, err: err instanceof Error ? err.message : String(err) }, '[WorkbenchJob] handler failed');
}
