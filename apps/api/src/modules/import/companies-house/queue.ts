import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../../config/env.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const chQueue = new Queue('companies-house', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
});

export async function addCHJob(companyNumber: string, tenantId: string, userId: string, runId?: string): Promise<string> {
  const jobId = `ch-${tenantId}-${companyNumber}`;

  await chQueue.add(
    'ch-import',
    { companyNumber, tenantId, runId, userId },
    { deduplication: { id: jobId, ttl: 300_000 }, jobId },
  );

  return jobId;
}
