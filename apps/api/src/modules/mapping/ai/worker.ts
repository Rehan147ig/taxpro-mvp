import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { env } from '../../../config/env.js';
import { withValidatedTenantContext } from '../../../config/db.js';
import { accounts } from '../../../db/schema/accounts.js';
import { taxMappings } from '../../../db/schema/tax-mappings.js';
import { logger } from '../../../lib/logger.js';
import { getAiModel } from '../../../config/ai.js';
import { classifyAccountsAI, fallbackClassify, type AIMappingInput } from './mapper.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export function startMappingWorker(): Worker {
  const worker = new Worker('taxpro-ai-mapping', async (job) => {
    const { tenantId } = job.data;
    logger.info({ tenantId, jobId: job.id }, '[MappingWorker] Starting');

    return withValidatedTenantContext(tenantId, async (tx) => {
      const tenantAccounts = await tx.select().from(accounts)
        .where(eq(accounts.tenantId, tenantId));

      const existingMappings = await tx.select().from(taxMappings)
        .where(eq(taxMappings.tenantId, tenantId));

      const mappedAccountIds = new Set(existingMappings.map(m => m.accountId));
      const unmappedAccounts = tenantAccounts.filter(a => !mappedAccountIds.has(a.id));

      if (unmappedAccounts.length === 0) {
        await job.updateProgress({ mapped: 0, total: 0, message: 'All accounts already mapped' });
        return { mapped: 0, total: tenantAccounts.length };
      }

      let aiAvailable = false;
      try {
        getAiModel();
        aiAvailable = true;
      } catch {
        aiAvailable = false;
      }

      const input: AIMappingInput[] = unmappedAccounts.map(a => ({
        id: a.id,
        accountNumber: a.accountNumber ?? '',
        name: a.name,
        type: a.type,
        detailType: a.detailType ?? undefined,
      }));

      const results = aiAvailable
        ? await classifyAccountsAI(input)
        : fallbackClassify(input);

      let inserted = 0;
      for (const r of results) {
        try {
          await tx.insert(taxMappings).values({
            tenantId,
            accountId: r.accountId,
            taxAccountType: r.taxAccountType,
            bookTreatment: r.bookTreatment,
            timingCategory: r.timingCategory,
            suggestedByAi: aiAvailable,
            aiExplanation: r.explanation,
            confidenceScore: String(r.confidenceScore),
            version: 1,
          });
          inserted++;
        } catch (err) {
          logger.error({ accountId: r.accountId, err }, '[MappingWorker] Insert failed');
        }
        await job.updateProgress({ mapped: inserted, total: results.length });
      }

      logger.info({ tenantId, inserted, total: tenantAccounts.length }, '[MappingWorker] Complete');
      return { mapped: inserted, total: tenantAccounts.length, source: aiAvailable ? 'ai' : 'fallback' };
    });
  }, { connection });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, tenantId: job?.data?.tenantId, err }, '[MappingWorker] Failed');
  });

  return worker;
}
