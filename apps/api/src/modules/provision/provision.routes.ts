import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { trialBalance } from '../../db/schema/trial-balance.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { provisionResults } from '../../db/schema/provision-results.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { aiRuns } from '../../db/schema/ai-runs.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { entities } from '../../db/schema/entities.js';
import { accounts } from '../../db/schema/accounts.js';
import { tenants } from '../../db/schema/tenants.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { BadRequestError } from '../../lib/errors.js';
import { generateProvisionWorkbook } from '../export/excel-generator.js';
import { generateWorkpaperPackage } from '../export/package-export.js';
import { createAuditLog } from '../export/audit-log.js';
import { analyzeProvision } from '../../agent/agent.js';
import { logger } from '../../lib/logger.js';
import { stableHash } from '../../eve/hash.js';
import { recordClassificationPattern } from '../../eve/pattern-store.js';
import { runMappingAgent } from '../../agent/subagents/mapping-agent.js';
import { draftAuditMemo } from '../../agent/subagents/audit-defense.js';
import { mineCredits } from '../../agent/subagents/credit-miner.js';
import { completeAiRun, failAiRun, startAiRun } from '../../eve/trace-store.js';
import { runProvisionMath } from './provision-calculator.js';

const INCOME_TYPES = new Set(['Income', 'Revenue', 'OtherIncome', 'Sales', 'ServiceRevenue']);
const EXPENSE_TYPES = new Set(['Expense', 'COGS', 'OtherExpense', 'OperatingExpense', 'SG&A', 'CostOfSales']);
const LOW_CONFIDENCE_THRESHOLD = 0.75;

export const provisionRoutes = new Hono();
provisionRoutes.use('*', authMiddleware);

const runProvisionSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endPeriod: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entityId: z.string().optional(),
});

provisionRoutes.post('/run', zValidator('json', runProvisionSchema), async (c) => {
  const user = c.get('user');
  const { period, endPeriod, entityId } = c.req.valid('json');
  // Eve runs by default. Use ?direct=true to bypass AI analysis.
  const useDirect = c.req.query('direct') === 'true';
  const mode = useDirect ? 'direct' : 'eve';

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
  if (!tenant) throw new BadRequestError('Tenant not found');

  const periodEnd = endPeriod ?? period;
  const tenantEntities = entityId
    ? await db.select().from(entities).where(and(eq(entities.tenantId, user.tenantId), eq(entities.id, entityId))).limit(1)
    : await db.select().from(entities).where(eq(entities.tenantId, user.tenantId));
  if (tenantEntities.length === 0) throw new BadRequestError('No entities found. Import trial balance data first.');

  const tbData = await db.select().from(trialBalance)
    .where(and(
      eq(trialBalance.tenantId, user.tenantId),
      gte(trialBalance.period, period),
      lte(trialBalance.period, periodEnd),
      ...(entityId ? [eq(trialBalance.entityId, entityId)] : []),
    ));
  if (tbData.length === 0) throw new BadRequestError('No trial balance data for this period.');

  const mappings = await db.select().from(taxMappings)
    .where(and(eq(taxMappings.tenantId, user.tenantId), eq(taxMappings.isActive, true)));
  const mappingMap = new Map(mappings.map((m) => [m.accountId, m]));

  const accountIds = [...new Set(tbData.map((t) => t.accountId))];
  const provisionAccounts = accountIds.length > 0
    ? await db.select().from(accounts)
      .where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, accountIds)))
    : [];
  const accountMap = new Map(provisionAccounts.map((account) => [account.id, account]));

  const inputDataHash = stableHash(tbData.map((row) => ({
    entityId: row.entityId,
    accountId: row.accountId,
    period: row.period,
    periodEnd: row.periodEnd,
    balance: row.balance,
  })));
  const mappingVersionHash = stableHash(mappings.map((mapping) => ({
    accountId: mapping.accountId,
    taxAccountType: mapping.taxAccountType,
    bookTreatment: mapping.bookTreatment,
    timingCategory: mapping.timingCategory,
    version: mapping.version,
  })));

  const [run] = await db.insert(provisionRuns).values({
    tenantId: user.tenantId,
    requestedByUserId: user.userId,
    period,
    endPeriod: periodEnd,
    entityId,
    mode,
    status: 'normalized',
    inputDataHash,
    mappingVersionHash,
  }).returning();

  try {
    // Auto-review: skip review queue if same data was previously approved
    const previousRun = await db.select().from(provisionRuns)
      .where(and(
        eq(provisionRuns.tenantId, user.tenantId),
        eq(provisionRuns.period, period),
        eq(provisionRuns.inputDataHash, inputDataHash),
        eq(provisionRuns.approvalStatus, 'approved'),
      ))
      .orderBy(desc(provisionRuns.createdAt))
      .limit(1);

    const reviewSummary = previousRun.length > 0
      ? { openCount: 0 }
      : await createReviewItemsForRun(run.id, user.tenantId, tbData, mappingMap, accountMap);
    const grouped = groupTrialBalanceByAccount(tbData);

    const calculationInput = !useDirect
      ? await buildAgentCalculationInput({
        tenant,
        userId: user.userId,
        provisionRunId: run.id,
        tenantId: user.tenantId,
        period,
        endPeriod: periodEnd,
        entityId,
        grouped,
        mappings,
        accountMap,
      }).catch(async (err) => {
        // Eve unavailable (rate limit, API down) — fall back to direct path
        logger.warn({ err }, '[Provision] Eve agent failed, falling back to direct');
        await db.update(provisionRuns).set({
          status: 'needs_review',
          exceptionSummary: `Eve agent unavailable: ${err instanceof Error ? err.message : 'Unknown error'}. Run processed in direct mode.`,
          updatedAt: new Date(),
        }).where(eq(provisionRuns.id, run.id));
        return buildDeterministicCalculationInput({
          period,
          entityId,
          grouped,
          mappingMap,
          accountMap,
          tbData,
          tenant,
        });
      })
      : buildDeterministicCalculationInput({
        period,
        entityId,
        grouped,
        mappingMap,
        accountMap,
        tbData,
        tenant,
      });

    await db.update(provisionRuns).set({
      status: reviewSummary.openCount > 0 ? 'needs_review' : 'calculated',
      approvalStatus: reviewSummary.openCount > 0 ? 'pending' : 'not_required',
      exceptionSummary: reviewSummary.openCount > 0 ? `${reviewSummary.openCount} review item(s) require attention` : null,
      updatedAt: new Date(),
    }).where(eq(provisionRuns.id, run.id));

    const calculation = runProvisionMath(calculationInput);
    const resultValues = {
      tenantId: user.tenantId,
      period,
      currentTaxExpense: String(calculation.summary.currentTaxExpense),
      deferredTaxExpense: String(calculation.summary.deferredTaxExpense),
      totalTaxExpense: String(calculation.summary.totalTaxExpense),
      bookIncome: String(calculation.summary.bookIncome),
      effectiveTaxRate: String(calculation.summary.effectiveTaxRate),
      statutoryRate: String(Number(tenant.taxRate)),
      taxPayable: String(calculation.summary.taxPayable),
      status: reviewSummary.openCount > 0 ? 'review_required' : 'draft',
    };

    const [result] = await db.insert(provisionResults).values(resultValues).onConflictDoUpdate({
      target: [provisionResults.tenantId, provisionResults.period],
      set: resultValues,
    }).returning();

    await db.update(provisionRuns).set({
      resultId: result.id,
      status: reviewSummary.openCount > 0 ? 'needs_review' : 'workpapers_generated',
      updatedAt: new Date(),
    }).where(eq(provisionRuns.id, run.id));

    // ── Subagent swarm: run all 3 in parallel (fire-and-forget with tracing) ──
    const subagentPromises = Promise.allSettled([
      runTracedSubagent({
        tenantId: user.tenantId,
        userId: user.userId,
        provisionRunId: run.id,
        workflowName: 'subagent_mapping_agent',
        promptVersion: 'mapping-agent-v1',
        input: {
        tenantId: user.tenantId,
        tenantName: tenant.name,
        accounts: Array.from(grouped.entries()).map(([accountId, netBalance]) => {
          const acct = accountMap.get(accountId);
          return {
            id: accountId,
            accountNumber: acct?.accountNumber ?? '',
            name: acct?.name ?? '',
            type: acct?.type ?? '',
            detailType: acct?.detailType ?? undefined,
            netBalance,
          };
        }),
        },
        execute: runMappingAgent,
      }),

      runTracedSubagent({
        tenantId: user.tenantId,
        userId: user.userId,
        provisionRunId: run.id,
        workflowName: 'subagent_audit_defense',
        promptVersion: 'audit-defense-v2',
        input: {
        entityName: tenant.name,
        period,
        bookIncome: calculation.summary.bookIncome,
        effectiveTaxRate: calculation.summary.effectiveTaxRate,
        statutoryRate: calculation.etr.statutoryRate,
        totalTaxExpense: calculation.summary.totalTaxExpense,
        currentTaxExpense: calculation.summary.currentTaxExpense,
        deferredTaxExpense: calculation.summary.deferredTaxExpense,
        taxPayable: calculation.summary.taxPayable,
        etrLines: calculation.etr.lines,
        permanentDifferences: (calculationInput.permanentDifferences ?? []).map(d => ({
          label: d.label,
          amount: d.amount,
        })),
        temporaryDifferences: (calculationInput.temporaryDifferences ?? []).map(d => ({
          timingCategory: d.timingCategory ?? 'TEMP_OTHER',
          difference: d.difference,
        })),
        },
        execute: draftAuditMemo,
      }),

      runTracedSubagent({
        tenantId: user.tenantId,
        userId: user.userId,
        provisionRunId: run.id,
        workflowName: 'subagent_credit_miner',
        promptVersion: 'credit-miner-v1',
        input: {
        tenantId: user.tenantId,
        tenantName: tenant.name,
        period,
        fiscalYear: new Date(period).getFullYear(),
        trialBalance: Array.from(grouped.entries()).map(([accountId, balance]) => {
          const acct = accountMap.get(accountId);
          return {
            accountId,
            accountName: acct?.name ?? '',
            accountNumber: acct?.accountNumber ?? '',
            accountType: acct?.type ?? '',
            balance,
          };
        }),
        },
        execute: mineCredits,
      }),
    ]);

    // Run subagents but don't block the response
    subagentPromises.then((results) => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        logger.warn({ failed: failed.length }, '[SubagentSwarm] Some subagents failed');
      }
    });

    return c.json({
      id: result.id,
      provisionRunId: run.id,
      mode,
      status: reviewSummary.openCount > 0 ? 'needs_review' : 'draft',
      review: reviewSummary,
      ...calculation,
      agent: !useDirect,
      agentReasoning: 'agentReasoning' in calculationInput ? calculationInput.agentReasoning : undefined,
    });
  } catch (err) {
    await db.update(provisionRuns).set({
      status: 'failed',
      exceptionSummary: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
    }).where(eq(provisionRuns.id, run.id));
    throw err;
  }
});

provisionRoutes.get('/runs', async (c) => {
  const user = c.get('user');
  const runs = await db.select().from(provisionRuns)
    .where(eq(provisionRuns.tenantId, user.tenantId))
    .orderBy(desc(provisionRuns.createdAt));
  return c.json(runs);
});

provisionRoutes.get('/runs/:id/review-items', async (c) => {
  const user = c.get('user');
  const items = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.tenantId, user.tenantId),
      eq(reviewItems.provisionRunId, c.req.param('id')),
    ))
    .orderBy(reviewItems.createdAt);
  return c.json(items);
});

provisionRoutes.get('/runs/:id/ai-findings', async (c) => {
  const user = c.get('user');
  const provisionRunId = c.req.param('id');
  const [run] = await db.select().from(provisionRuns)
    .where(and(
      eq(provisionRuns.id, provisionRunId),
      eq(provisionRuns.tenantId, user.tenantId),
    ))
    .limit(1);

  if (!run) throw new BadRequestError('Provision run not found');

  const agentRuns = await db.select().from(aiRuns)
    .where(and(
      eq(aiRuns.tenantId, user.tenantId),
      eq(aiRuns.provisionRunId, provisionRunId),
    ))
    .orderBy(aiRuns.startedAt);

  const trackedSubagents = new Set([
    'subagent_mapping_agent',
    'subagent_audit_defense',
    'subagent_credit_miner',
  ]);
  const hasPendingSubagent = agentRuns.some((agentRun) =>
    trackedSubagents.has(agentRun.workflowName) && agentRun.status === 'started',
  );

  return c.json({
    provisionRunId,
    pending: hasPendingSubagent,
    agents: agentRuns.map((agentRun) => ({
      workflowName: agentRun.workflowName,
      status: agentRun.status,
      promptVersion: agentRun.promptVersion,
      provider: agentRun.provider,
      model: agentRun.model,
      errorMessage: agentRun.errorMessage,
      startedAt: agentRun.startedAt,
      completedAt: agentRun.completedAt,
      output: agentRun.outputJson,
    })),
  });
});

provisionRoutes.get('/results', async (c) => {
  const user = c.get('user');
  const results = await db.select().from(provisionResults)
    .where(eq(provisionResults.tenantId, user.tenantId))
    .orderBy(desc(provisionResults.createdAt));
  return c.json(results);
});

provisionRoutes.get('/results/:id', async (c) => {
  const user = c.get('user');
  const [result] = await db.select().from(provisionResults)
    .where(and(
      eq(provisionResults.id, c.req.param('id')),
      eq(provisionResults.tenantId, user.tenantId),
    )).limit(1);

  if (!result) throw new BadRequestError('Provision result not found');
  return c.json(result);
});

provisionRoutes.get('/results/:id/export', async (c) => {
  const user = c.get('user');
  const [result] = await db.select().from(provisionResults)
    .where(and(
      eq(provisionResults.id, c.req.param('id')),
      eq(provisionResults.tenantId, user.tenantId),
    )).limit(1);

  if (!result) throw new BadRequestError('Provision result not found');

  const buf = await generateProvisionWorkbook({
    period: result.period,
    bookIncome: Number(result.bookIncome ?? 0),
    currentTaxExpense: Number(result.currentTaxExpense ?? 0),
    deferredTaxExpense: Number(result.deferredTaxExpense ?? 0),
    totalTaxExpense: Number(result.totalTaxExpense ?? 0),
    effectiveTaxRate: Number(result.effectiveTaxRate ?? 0),
    statutoryRate: Number(result.statutoryRate ?? 0),
    taxPayable: Number(result.taxPayable ?? 0),
    valuationAllowance: Number(result.valuationAllowance ?? 0),
    createdAt: result.createdAt?.toISOString?.() ?? String(result.createdAt ?? ''),
  });

  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', `attachment; filename="taxpro-provision-${result.period}.xlsx"`);
  return c.body(buf as any);
});

function groupTrialBalanceByAccount(tbData: Array<typeof trialBalance.$inferSelect>) {
  const grouped = new Map<string, number>();
  for (const tb of tbData) {
    grouped.set(tb.accountId, (grouped.get(tb.accountId) ?? 0) + Number(tb.balance ?? 0));
  }
  return grouped;
}

function buildDeterministicCalculationInput(args: {
  period: string;
  entityId?: string;
  grouped: Map<string, number>;
  mappingMap: Map<string, typeof taxMappings.$inferSelect>;
  accountMap: Map<string, typeof accounts.$inferSelect>;
  tbData: Array<typeof trialBalance.$inferSelect>;
  tenant: typeof tenants.$inferSelect;
}) {
  let totalRevenue = 0;
  let totalExpenses = 0;
  const permanentDifferences: { amount: number; label: string }[] = [];
  const temporaryDifferences: {
    accountId: string;
    entityId: string;
    period: string;
    bookBalance: number;
    taxBalance: number;
    difference: number;
    diffType: 'temporary';
    timingCategory?: string;
  }[] = [];

  for (const [accountId, balance] of args.grouped) {
    const mapping = args.mappingMap.get(accountId);
    const account = args.accountMap.get(accountId);
    if (account?.type && INCOME_TYPES.has(account.type)) totalRevenue += Math.abs(balance);
    if (account?.type && EXPENSE_TYPES.has(account.type)) totalExpenses += Math.abs(balance);
    if (!mapping) continue;

    if (mapping.bookTreatment === 'permanent') {
      permanentDifferences.push({ amount: balance, label: mapping.taxAccountType });
    } else if (mapping.bookTreatment === 'temporary') {
      temporaryDifferences.push({
        accountId,
        entityId: args.tbData.find((t) => t.accountId === accountId)?.entityId ?? args.entityId ?? 'consolidated',
        period: args.period,
        bookBalance: balance,
        taxBalance: 0,
        difference: balance,
        diffType: 'temporary',
        timingCategory: mapping.timingCategory ?? undefined,
      });
    }
  }

  return {
    bookIncome: totalRevenue - totalExpenses,
    permanentDifferences,
    temporaryDifferences,
    federalRate: Number(args.tenant.taxRate),
    stateRate: Number(args.tenant.stateTaxRate ?? 0),
    taxCredits: 0,
    estimatedPayments: 0,
    nolUtilization: 0,
    entityId: args.entityId ?? 'consolidated',
    period: args.period,
  };
}

async function buildAgentCalculationInput(args: {
  tenant: typeof tenants.$inferSelect;
  tenantId: string;
  userId: string;
  provisionRunId: string;
  period: string;
  endPeriod?: string;
  entityId?: string;
  grouped: Map<string, number>;
  mappings: Array<typeof taxMappings.$inferSelect>;
  accountMap: Map<string, typeof accounts.$inferSelect>;
}) {
  const trialBalanceForAgent = Array.from(args.grouped.entries()).map(([accountId, balance]) => {
    const account = args.accountMap.get(accountId);
    return {
      accountId,
      accountName: account?.name ?? '',
      accountNumber: account?.accountNumber ?? '',
      accountType: account?.type ?? '',
      netBalance: balance,
    };
  });

  const agentInput = {
    tenantId: args.tenantId,
    tenantName: args.tenant.name,
    period: args.period,
    endPeriod: args.endPeriod,
    entityId: args.entityId,
    federalRate: Number(args.tenant.taxRate),
    stateRate: Number(args.tenant.stateTaxRate ?? 0),
    trialBalance: trialBalanceForAgent,
    mappings: args.mappings.map((m) => ({
      accountId: m.accountId,
      taxAccountType: m.taxAccountType,
      bookTreatment: m.bookTreatment,
      timingCategory: m.timingCategory,
      confidenceScore: Number(m.confidenceScore ?? 0),
      explanation: m.aiExplanation,
    })),
  };

  const aiRun = await startAiRun({
    tenantId: args.tenantId,
    userId: args.userId,
    provisionRunId: args.provisionRunId,
    workflowName: 'eve_provision_analysis',
    promptVersion: 'eve-provision-analysis-v1',
  }, agentInput);

  try {
    const agentResult = await analyzeProvision(agentInput);
    if (!agentResult.success) throw new BadRequestError(`Agent analysis failed: ${agentResult.error ?? 'Unknown error'}`);
    await completeAiRun(aiRun.id, agentResult);

    return {
      bookIncome: agentResult.bookIncome,
      permanentDifferences: agentResult.permanentDifferences.map((pd) => ({ amount: pd.amount, label: pd.label })),
      temporaryDifferences: agentResult.temporaryDifferences.map((d) => ({
        accountId: d.accountId,
        entityId: d.entityId,
        period: d.period,
        bookBalance: d.bookBalance,
        taxBalance: d.taxBalance,
        difference: d.difference,
        diffType: 'temporary' as const,
        timingCategory: d.timingCategory ?? 'TEMP_OTHER',
      })),
      federalRate: Number(args.tenant.taxRate),
      stateRate: Number(args.tenant.stateTaxRate ?? 0),
      taxCredits: 0,
      estimatedPayments: 0,
      nolUtilization: 0,
      entityId: args.entityId ?? 'consolidated',
      period: args.period,
      agentReasoning: agentResult.reasoning,
    };
  } catch (err) {
    await failAiRun(aiRun.id, err);
    logger.error({ err, provisionRunId: args.provisionRunId }, '[Provision] Eve workflow failed');
    throw err;
  }
}

async function runTracedSubagent<Input, Output>(args: {
  tenantId: string;
  userId: string;
  provisionRunId: string;
  workflowName: string;
  promptVersion: string;
  input: Input;
  execute: (input: Input) => Promise<Output>;
}) {
  const aiRun = await startAiRun({
    tenantId: args.tenantId,
    userId: args.userId,
    provisionRunId: args.provisionRunId,
    workflowName: args.workflowName,
    promptVersion: args.promptVersion,
  }, args.input);

  try {
    const output = await args.execute(args.input);
    await completeAiRun(aiRun.id, output);
    return output;
  } catch (err) {
    await failAiRun(aiRun.id, err);
    throw err;
  }
}

async function createReviewItemsForRun(
  provisionRunId: string,
  tenantId: string,
  tbData: Array<typeof trialBalance.$inferSelect>,
  mappingMap: Map<string, typeof taxMappings.$inferSelect>,
  accountMap: Map<string, typeof accounts.$inferSelect>,
) {
  let openCount = 0;
  const accountIds = [...new Set(tbData.map((tb) => tb.accountId))];

  for (const accountId of accountIds) {
    const mapping = mappingMap.get(accountId);
    const account = accountMap.get(accountId);
    if (!mapping) {
      openCount++;
      await db.insert(reviewItems).values({
        tenantId,
        provisionRunId,
        itemType: 'missing_mapping',
        severity: 'high',
        title: `Missing tax mapping for ${account?.name ?? accountId}`,
        description: 'This account is included in the trial balance but has no active tax mapping. A reviewer should classify it before final delivery.',
        accountId,
        sourceRef: account?.accountNumber,
      });
      continue;
    }

    const confidence = Number(mapping.confidenceScore ?? 1);
    if (mapping.suggestedByAi && confidence < LOW_CONFIDENCE_THRESHOLD) {
      openCount++;
      await db.insert(reviewItems).values({
        tenantId,
        provisionRunId,
        itemType: 'low_confidence_mapping',
        severity: 'medium',
        title: `Review AI mapping for ${account?.name ?? accountId}`,
        description: mapping.aiExplanation ?? 'AI mapping confidence is below the review threshold.',
        accountId,
        sourceRef: account?.accountNumber,
        confidenceScore: Math.round(confidence * 100),
        metadata: {
          taxAccountType: mapping.taxAccountType,
          bookTreatment: mapping.bookTreatment,
          timingCategory: mapping.timingCategory,
        },
      });
    }
  }

  return { openCount };
}

// ── Package export: zip with .xlsx + audit trail ──
provisionRoutes.get('/results/:id/package', async (c) => {
  const user = c.get('user');
  const [result] = await db.select().from(provisionResults)
    .where(and(
      eq(provisionResults.id, c.req.param('id')),
      eq(provisionResults.tenantId, user.tenantId),
    )).limit(1);
  if (!result) throw new BadRequestError('Provision result not found');

  const [run] = await db.select().from(provisionRuns)
    .where(and(
      eq(provisionRuns.tenantId, user.tenantId),
      eq(provisionRuns.resultId, result.id),
    )).limit(1);

  const auditLog = createAuditLog();
  auditLog.add('provision_run', `Provision run for ${result.period}`, { mode: run?.mode ?? 'unknown' });

  if (run) {
    const reviewItemsData = await db.select().from(reviewItems)
      .where(eq(reviewItems.provisionRunId, run.id));
    for (const item of reviewItemsData) {
      auditLog.add(`review_item:${item.itemType}`, item.title, item.metadata as Record<string, unknown> ?? {}, 'system');
    }
  }

  const buf = await generateWorkpaperPackage({
    period: result.period,
    bookIncome: Number(result.bookIncome ?? 0),
    currentTaxExpense: Number(result.currentTaxExpense ?? 0),
    deferredTaxExpense: Number(result.deferredTaxExpense ?? 0),
    totalTaxExpense: Number(result.totalTaxExpense ?? 0),
    effectiveTaxRate: Number(result.effectiveTaxRate ?? 0),
    statutoryRate: Number(result.statutoryRate ?? 0),
    taxPayable: Number(result.taxPayable ?? 0),
    valuationAllowance: Number(result.valuationAllowance ?? 0),
    createdAt: result.createdAt?.toISOString?.() ?? String(result.createdAt ?? ''),
    auditEntries: auditLog.entries,
  });

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="taxpro-package-${result.period}.zip"`);
  return c.body(buf as any);
});

// ── Eve assistant: conversational workflow operator ──
provisionRoutes.post('/eve/ask', async (c) => {
  const user = c.get('user');
  const { prompt } = await c.req.json() as { prompt: string };
  if (!prompt) throw new BadRequestError('Missing "prompt" in request body');

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
  if (!tenant) throw new BadRequestError('Tenant not found');

  const recentRuns = await db.select().from(provisionRuns)
    .where(eq(provisionRuns.tenantId, user.tenantId))
    .orderBy(desc(provisionRuns.createdAt))
    .limit(5);

  const systemContext = `You are Eve, TaxPro's AI provision assistant. You help corporate tax professionals run and review ASC 740 tax provisions.

Current tenant: ${tenant.name}
Recent provision runs: ${recentRuns.length > 0 ? recentRuns.map(r => `- ${r.period} (status: ${r.status}, mode: ${r.mode})`).join('\n') : 'None yet'}

You can answer questions about provision results, suggest next steps, and flag items needing review.`;

  const { callJsonModel } = await import('../../eve/model-client.js');
  const response = await callJsonModel<{ answer: string; suggestedAction?: string }>({
    system: systemContext,
    user: prompt,
    promptVersion: 'eve-assistant-v1',
    temperature: 0.3,
  });

  return c.json({ answer: response.parsed.answer, suggestedAction: response.parsed.suggestedAction });
});

// ── Review endpoints ──

// Resolve a single review item (approve/override)
const resolveReviewItemSchema = z.object({
  resolution: z.enum(['approved', 'rejected', 'override']),
  resolutionNote: z.string().optional(),
});

provisionRoutes.post('/runs/:runId/review-items/:itemId/resolve', zValidator('json', resolveReviewItemSchema), async (c) => {
  const user = c.get('user');
  const { runId, itemId } = c.req.param();
  const { resolution, resolutionNote } = c.req.valid('json');

  const [item] = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.id, itemId),
      eq(reviewItems.provisionRunId, runId),
      eq(reviewItems.tenantId, user.tenantId),
    )).limit(1);
  if (!item) throw new BadRequestError('Review item not found');

  const resolvedStatus = resolution === 'rejected' ? 'rejected' : 'resolved';
  await db.update(reviewItems).set({
    status: resolvedStatus,
    resolvedByUserId: user.userId,
    resolutionNote: resolutionNote ?? null,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(reviewItems.id, itemId));

  // Record classification pattern for learning
  if (item.accountId && resolution !== 'rejected') {
    recordClassificationPattern({
      tenantId: user.tenantId,
      accountId: item.accountId,
      resolution: resolution as any,
      resolvedByUserId: user.userId,
      resolutionNote: resolutionNote ?? undefined,
    }).catch((err) => logger.error({ err }, '[Pattern] Failed to record'));
  }

  // Check if all items resolved, then update run
  const openItems = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.provisionRunId, runId),
      eq(reviewItems.status, 'open'),
    ));
  const resolvedItems = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.provisionRunId, runId),
      eq(reviewItems.status, 'resolved'),
    ));
  const rejectedItems = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.provisionRunId, runId),
      eq(reviewItems.status, 'rejected'),
    ));

  if (openItems.length === 0) {
    await db.update(provisionRuns).set({
      approvalStatus: 'approved',
      updatedAt: new Date(),
    }).where(eq(provisionRuns.id, runId));
  }

  return c.json({ itemId, status: resolvedStatus, openRemaining: openItems.length });
});

// Bulk resolve all open items for a run
provisionRoutes.post('/runs/:runId/review-items/bulk-resolve', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();
  const { resolution, resolutionNote } = await c.req.json() as { resolution: string; resolutionNote?: string };

  const openItems = await db.select().from(reviewItems)
    .where(and(
      eq(reviewItems.provisionRunId, runId),
      eq(reviewItems.tenantId, user.tenantId),
      eq(reviewItems.status, 'open'),
    ));

  const newStatus = resolution === 'approved' ? 'resolved' : 'rejected';
  for (const item of openItems) {
    await db.update(reviewItems).set({
      status: newStatus,
      resolvedByUserId: user.userId,
      resolutionNote: resolutionNote ?? null,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(reviewItems.id, item.id));
  }

  await db.update(provisionRuns).set({
    approvalStatus: resolution === 'approved' ? 'approved' : 'rejected',
    updatedAt: new Date(),
  }).where(eq(provisionRuns.id, runId));

  return c.json({ resolved: openItems.length, status: newStatus });
});

// Finalize a provision run (mark as delivered)
provisionRoutes.post('/runs/:runId/finalize', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();

  const [run] = await db.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

  const openItems = await db.select().from(reviewItems)
    .where(and(eq(reviewItems.provisionRunId, runId), eq(reviewItems.status, 'open')));
  if (openItems.length > 0) throw new BadRequestError(`Cannot finalize: ${openItems.length} review item(s) still open`);

  await db.update(provisionRuns).set({
    status: 'finalized',
    finalizedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(provisionRuns.id, runId));

  return c.json({ runId, status: 'finalized' });
});

// Phase 2 Governance Endpoints

// Submit for partner approval
provisionRoutes.post('/runs/:runId/submit-for-approval', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();

  const [run] = await db.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

  await db.update(provisionRuns).set({
    approvalStatus: 'pending_partner_review',
    updatedAt: new Date(),
  }).where(eq(provisionRuns.id, runId));

  return c.json({ runId, approvalStatus: 'pending_partner_review' });
});

// Partner approval
provisionRoutes.post('/runs/:runId/partner-approve', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();

  const [run] = await db.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

  await db.update(provisionRuns).set({
    approvalStatus: 'approved',
    updatedAt: new Date(),
  }).where(eq(provisionRuns.id, runId));

  return c.json({ runId, approvalStatus: 'approved' });
});

// Lock run
provisionRoutes.post('/runs/:runId/lock', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();

  const [run] = await db.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

  if (run.approvalStatus !== 'approved') {
    throw new BadRequestError('Run must be approved by a partner before locking');
  }

  await db.update(provisionRuns).set({
    status: 'locked',
    finalizedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(provisionRuns.id, runId));

  return c.json({ runId, status: 'locked' });
});

// Get trial balance detail for a run
provisionRoutes.get('/runs/:runId/trial-balance-detail', async (c) => {
  const user = c.get('user');
  const { runId } = c.req.param();
  
  const [run] = await db.select().from(provisionRuns)
    .where(and(eq(provisionRuns.id, runId), eq(provisionRuns.tenantId, user.tenantId))).limit(1);
  if (!run) throw new BadRequestError('Provision run not found');

  const tbData = await db.select({
    accountId: trialBalance.accountId,
    accountName: accounts.name,
    accountNumber: accounts.accountNumber,
    type: accounts.type,
    balance: trialBalance.balance,
    taxAccountType: taxMappings.taxAccountType,
    bookTreatment: taxMappings.bookTreatment,
    confidenceScore: taxMappings.confidenceScore,
    suggestedByAi: taxMappings.suggestedByAi,
    mappingVersion: taxMappings.version,
  }).from(trialBalance)
    .innerJoin(accounts, eq(trialBalance.accountId, accounts.id))
    .leftJoin(taxMappings, and(
      eq(taxMappings.accountId, accounts.id),
      eq(taxMappings.isActive, true)
    ))
    .where(and(
      eq(trialBalance.tenantId, user.tenantId),
      gte(trialBalance.period, run.period),
      lte(trialBalance.period, run.endPeriod ?? run.period),
      run.entityId ? eq(trialBalance.entityId, run.entityId) : undefined
    ));

  // Group by account to sum balances across entities/periods
  const grouped = new Map<string, any>();
  for (const row of tbData) {
    if (!grouped.has(row.accountId)) {
      grouped.set(row.accountId, {
        accountId: row.accountId,
        accountName: row.accountName,
        accountNumber: row.accountNumber,
        type: row.type,
        balance: 0,
        taxAccountType: row.taxAccountType,
        bookTreatment: row.bookTreatment,
        confidenceScore: row.confidenceScore ? Number(row.confidenceScore) : null,
        suggestedByAi: row.suggestedByAi,
      });
    }
    grouped.get(row.accountId)!.balance += Number(row.balance);
  }

  // Also include the review items for this run so the UI can flag them
  const items = await db.select().from(reviewItems)
    .where(eq(reviewItems.provisionRunId, runId));
  
  const results = Array.from(grouped.values()).map(row => {
    const reviewItem = items.find(i => i.accountId === row.accountId);
    return {
      ...row,
      reviewItemId: reviewItem?.id,
      reviewItemStatus: reviewItem?.status,
      reviewItemSeverity: reviewItem?.severity,
    };
  });

  return c.json(results);
});

// Review queue summary — all runs needing review across tenant
provisionRoutes.get('/review/queue', async (c) => {
  const user = c.get('user');

  const needsReviewRuns = await db.select().from(provisionRuns)
    .where(and(
      eq(provisionRuns.tenantId, user.tenantId),
      eq(provisionRuns.status, 'needs_review'),
    ))
    .orderBy(desc(provisionRuns.createdAt));

  const summary = await Promise.all(needsReviewRuns.map(async (run) => {
    const openItems = await db.select().from(reviewItems)
      .where(and(
        eq(reviewItems.provisionRunId, run.id),
        eq(reviewItems.status, 'open'),
      ))
      .orderBy(reviewItems.createdAt);
    return { run, openItems };
  }));

  return c.json(summary);
});
