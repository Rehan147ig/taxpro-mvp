import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { env } from '../../../config/env.js';
import { withValidatedTenantContext } from '../../../config/db.js';
import { logger } from '../../../lib/logger.js';
import { accounts } from '../../../db/schema/accounts.js';
import { taxMappings } from '../../../db/schema/tax-mappings.js';
import { reviewItems } from '../../../db/schema/review-items.js';
import { recordProvisionEvent, EVENT_TYPES } from '../../provision/provision-events.js';
import { startAiRun, completeAiRun } from '../../../eve/trace-store.js';
import { findPrecedentMappings, suggestMapping } from './precedent-engine.js';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

interface AutoMappingResult {
  total: number;
  drafted: number;
  active: number;
  reviewItems: number;
  summary: string;
  matchedByBreakdown: { exact: number; pattern: number; fallback: number };
}

export function startAutoMappingWorker(): Worker {
  const worker = new Worker('taxpro-auto-mapping', async (job) => {
    const { tenantId } = job.data;
    logger.info({ tenantId, jobId: job.id }, '[AutoMappingWorker] Starting');

    return withValidatedTenantContext(tenantId, async (tx) => {
      const tenantAccounts = await tx.select().from(accounts)
        .where(eq(accounts.tenantId, tenantId));

      if (tenantAccounts.length === 0) {
        return { total: 0, drafted: 0, active: 0, reviewItems: 0, summary: 'No accounts to map', matchedByBreakdown: { exact: 0, pattern: 0, fallback: 0 } };
      }

      const existingMappings = await tx.select().from(taxMappings)
        .where(eq(taxMappings.tenantId, tenantId));

      const alreadyMapped = new Set(existingMappings.map((m: typeof taxMappings.$inferSelect) => m.accountId));

      const unmappedAccounts = tenantAccounts.filter((a: typeof accounts.$inferSelect) => !alreadyMapped.has(a.id));

      if (unmappedAccounts.length === 0) {
        return { total: tenantAccounts.length, drafted: 0, active: 0, reviewItems: 0, summary: `All ${tenantAccounts.length} accounts already mapped`, matchedByBreakdown: { exact: 0, pattern: 0, fallback: 0 } };
      }

      logger.info({ tenantId, unmapped: unmappedAccounts.length, total: tenantAccounts.length }, '[AutoMappingWorker] Accounts to process');

      const aiRun = await startAiRun(tx, {
        tenantId,
        workflowName: 'auto_mapping',
        promptVersion: 'phase4-v1',
      }, { accountCount: unmappedAccounts.length });

      const accountTypes = [...new Set(unmappedAccounts.map((a: typeof accounts.$inferSelect) => a.type))];
      const precedentsByType = new Map<string, Awaited<ReturnType<typeof findPrecedentMappings>>>();
      for (const t of accountTypes) {
        precedentsByType.set(t, await findPrecedentMappings(tx, tenantId, t));
      }

      const results = {
        drafted: 0,
        active: 0,
        reviewItems: 0,
        exact: 0,
        pattern: 0,
        fallback: 0,
      };

      const createdReviewItemAccountIds: string[] = [];

      for (const account of unmappedAccounts) {
        const precedents = precedentsByType.get(account.type) ?? [];
        const suggestion = await suggestMapping(tx, tenantId, account, precedents);

        const suggestionStatus = suggestion.confidenceLabel === 'high' ? 'draft' : 'draft';

        await tx.insert(taxMappings).values({
          tenantId,
          accountId: account.id,
          taxAccountType: suggestion.taxAccountType,
          bookTreatment: suggestion.bookTreatment,
          timingCategory: suggestion.timingCategory,
          confidenceScore: String(suggestion.confidenceScore),
          suggestedByAi: true,
          aiExplanation: suggestion.rationale,
          status: suggestionStatus,
          version: 1,
        });

        if (suggestion.matchedBy === 'exact') results.exact++;
        else if (suggestion.matchedBy === 'pattern') results.pattern++;
        else results.fallback++;

        results.drafted++;

        await recordProvisionEvent({
          tenantId,
          provisionRunId: '',
          eventType: EVENT_TYPES.MAPPING_SUGGESTED,
          actorType: 'agent',
          actorAgentId: aiRun.id,
          reason: suggestion.rationale,
          metadata: {
            accountId: account.id,
            accountName: account.name,
            taxAccountType: suggestion.taxAccountType,
            confidenceScore: suggestion.confidenceScore,
            confidenceLabel: suggestion.confidenceLabel,
            matchedBy: suggestion.matchedBy,
            citedPrecedentId: suggestion.citedPrecedentId,
            citedAccountName: suggestion.citedAccountName,
            rationale: suggestion.rationale,
          },
        }, tx);

        if (suggestion.confidenceLabel === 'low' || suggestion.matchedBy === 'fallback') {
          await tx.insert(reviewItems).values({
            tenantId,
            itemType: 'low_confidence_mapping',
            severity: 'medium',
            status: 'open',
            title: `Review auto-mapping for ${account.name}`,
            description: suggestion.rationale,
            accountId: account.id,
            sourceRef: account.accountNumber,
            confidenceScore: Math.round(suggestion.confidenceScore * 100),
            metadata: JSON.stringify({
              taxAccountType: suggestion.taxAccountType,
              bookTreatment: suggestion.bookTreatment,
              timingCategory: suggestion.timingCategory,
              matchedBy: suggestion.matchedBy,
              citedPrecedentId: suggestion.citedPrecedentId,
            }),
          });

          createdReviewItemAccountIds.push(account.id);
          results.reviewItems++;

          await recordProvisionEvent({
            tenantId,
            provisionRunId: '',
            eventType: EVENT_TYPES.AI_ACTION_ESCALATED,
            actorType: 'agent',
            actorAgentId: aiRun.id,
            reason: `Low confidence mapping for ${account.name} (${suggestion.confidenceLabel}, score: ${Math.round(suggestion.confidenceScore * 100)}%)`,
            metadata: {
              accountId: account.id,
              accountName: account.name,
              confidenceScore: suggestion.confidenceScore,
              matchedBy: suggestion.matchedBy,
            },
          }, tx);
        }
      }

      await completeAiRun(aiRun.id, {
        totalAccounts: unmappedAccounts.length,
        drafted: results.drafted,
        reviewItems: results.reviewItems,
        matchedBy: { exact: results.exact, pattern: results.pattern, fallback: results.fallback },
      }, tx);

      const totalMapped = results.exact + results.pattern + results.fallback;
      const summary = `Draft mapping ready; ${totalMapped} of ${unmappedAccounts.length} accounts matched approved precedent; ${results.reviewItems} items require review`;

      logger.info({ tenantId, ...results, total: unmappedAccounts.length }, '[AutoMappingWorker] Complete');

      return {
        total: unmappedAccounts.length,
        drafted: results.drafted,
        active: results.active,
        reviewItems: results.reviewItems,
        summary,
        matchedByBreakdown: { exact: results.exact, pattern: results.pattern, fallback: results.fallback },
      } satisfies AutoMappingResult;
    });
  }, { connection });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, tenantId: job?.data?.tenantId, err }, '[AutoMappingWorker] Failed');
  });

  return worker;
}
