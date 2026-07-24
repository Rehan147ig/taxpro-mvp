import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../../config/env.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const mappingQueue = new Queue('taxpro-ai-mapping', { connection });
export const mappingQueueEvents = new QueueEvents('taxpro-ai-mapping', { connection });

export async function addMappingJob(tenantId: string): Promise<string> {
  const job = await mappingQueue.add('map-accounts', { tenantId }, {
    // Prevent duplicate jobs for the same tenant
    deduplication: { id: `map-${tenantId}`, ttl: 60000 },
  });
  return job.id!;
}
