import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../../config/env.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const autoMappingQueue = new Queue('taxpro-auto-mapping', { connection });

export async function addAutoMappingJob(tenantId: string): Promise<string> {
  const job = await autoMappingQueue.add('auto-map-accounts', { tenantId }, {
    deduplication: { id: `auto-map-${tenantId}`, ttl: 120000 },
  });
  return job.id!;
}
