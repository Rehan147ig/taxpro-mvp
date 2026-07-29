import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../../../config/env.js';
import { withValidatedTenantContext } from '../../../config/db.js';
import { requireRunAccess } from '../../../lib/middleware/rbac.js';
import { recordProvisionEvent } from '../../provision/provision-events.js';
import { logger } from '../../../lib/logger.js';
import { fetchCompanyProfile, isRateLimitError } from './client.js';
import { normalizeCompanyNumber } from './validator.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export interface CHJobData {
  companyNumber: string;
  tenantId: string;
  runId?: string;
  userId: string;
}

export function startCHWorker(): Worker {
  const worker = new Worker<CHJobData>(
    'companies-house',
    async (job) => {
      const { companyNumber, tenantId, runId, userId } = job.data;
      logger.info({ companyNumber, tenantId, jobId: job.id }, '[CHWorker] Starting');

      const normalized = normalizeCompanyNumber(companyNumber);

      const profile = await fetchCompanyProfile(normalized);
      logger.info({ companyNumber: normalized, companyName: profile.companyName }, '[CHWorker] Profile fetched');

      await withValidatedTenantContext(tenantId, async (tx) => {
        if (runId) {
          await requireRunAccess(runId, tenantId, tx, true);
        }

        await recordProvisionEvent({
          tenantId,
          provisionRunId: runId ?? '',
          eventType: 'companies_house_import',
          actorType: 'system',
          actorUserId: userId || null,
          reason: `Imported Companies House profile for ${normalized} (${profile.companyName})`,
          metadata: {
            companyNumber: normalized,
            companyName: profile.companyName,
            companyStatus: profile.companyStatus,
            jurisdiction: profile.jurisdiction,
          },
        }, tx);
      });

      logger.info({ companyNumber: normalized, jobId: job.id }, '[CHWorker] Complete');
      return { companyNumber: normalized, companyName: profile.companyName, status: profile.companyStatus };
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 550, duration: 300_000 },
    },
  );

  worker.on('failed', (job, err) => {
    if (isRateLimitError(err)) {
      logger.warn({ jobId: job?.id, companyNumber: job?.data?.companyNumber, retryAfter: err.retryAfter }, '[CHWorker] Rate limited, will retry');
    } else {
      logger.error({ jobId: job?.id, companyNumber: job?.data?.companyNumber, err }, '[CHWorker] Failed');
    }
  });

  return worker;
}
