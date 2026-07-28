import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { parseTrialBalance } from '../parser/parser-agent.js';
import { classifyAccounts } from '../mapping/mapping-agent.js';
import { generateExplanation } from '../explanation/explanation-agent.js';
import { auditProvision } from '../audit/audit-agent.js';
import { calculateDeferredTax } from '../../packages/tax-engine/src/deferred-tax.js';
import { calculateCurrentTax } from '../../packages/tax-engine/src/current-tax.js';
import { calculateETR } from '../../packages/tax-engine/src/etr-reconciliation.js';
import type { Jurisdiction } from '../../packages/tax-engine/src/types.js';
import type { TaxProvisionState, PipelineStage } from '../../apps/api/src/state/tax-provision-state.js';
import { assertNotLocked, transitionStage } from '../../apps/api/src/state/tax-provision-state.js';
import { logger } from '../../apps/api/src/lib/logger.js';

const QUEUE_NAME = 'taxpro-agent-pipeline';
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

export const agentQueue = new Queue<TaxProvisionState>(QUEUE_NAME, { connection });

const STAGE_ORDER: PipelineStage[] = ['parse', 'map', 'calculate', 'explain', 'audit', 'review'];

async function processState(initial: TaxProvisionState): Promise<TaxProvisionState> {
  let state: TaxProvisionState = { ...initial };

  try {
    assertNotLocked(state);
    state = transitionStage(state, 'parse', ['parse']);
    const parseResult = await parseTrialBalance(initial.rawInput || '', 'csv');
    state.parsedItems = parseResult.items;

    state = transitionStage(state, 'map', ['parse']);
    const mappedItems = await classifyAccounts(
      state.parsedItems.map(p => ({
        accountNumber: p.accountNumber,
        accountName: p.accountName,
        accountType: p.accountType,
        debit: p.debit,
        credit: p.credit,
        balance: p.balance,
      })),
      state.jurisdiction as Jurisdiction,
    );
    state.mappedItems = mappedItems;

    state = transitionStage(state, 'calculate', ['map']);
    const taxRate = state.jurisdiction === 'UK_FRS102_S29' ? 0.25 : 0.21;
    const currentTax = calculateCurrentTax({
      bookIncome: new (await import('decimal.js')).default(state.parsedItems.reduce((s, i) => s + parseFloat(i.balance), 0)),
      permanentDifferences: [],
      taxRate: new (await import('decimal.js')).default(taxRate),
      taxCredits: new (await import('decimal.js')).default(0),
      estimatedPayments: new (await import('decimal.js')).default(0),
      nolUtilization: new (await import('decimal.js')).default(0),
      asOfDate: new Date().toISOString(),
    });
    const deferredTax = calculateDeferredTax(
      [],
      {}, {}, {},
      state.jurisdiction as Jurisdiction,
    );
    const etr = calculateETR({
      bookIncome: currentTax.bookIncome,
      federalTaxRate: currentTax.federalTaxRate,
      federalTax: currentTax.federalTax,
      stateTax: currentTax.stateTax,
      permanentDifferences: [],
      taxCredits: currentTax.taxCredits,
      otherAdjustments: [],
    });
    state.engineOutput = { currentTax, deferredTax, etr };

    state = transitionStage(state, 'explain', ['calculate']);
    const explanations = await generateExplanation({
      bookIncome: currentTax.bookIncome.toString(),
      currentTax: currentTax as unknown as Record<string, unknown>,
      deferredTax: deferredTax as unknown as Record<string, unknown>,
      etr: etr as unknown as Record<string, unknown>,
      jurisdiction: state.jurisdiction,
      jurisdictionRules: state.jurisdiction === 'UK_FRS102_S29'
        ? 'FRS 102 Section 29: no discounting, probable recovery required, debtors/provisions presentation'
        : 'ASC 740: 21% federal rate, valuation allowance assessment, ETR reconciliation required',
    });
    state.explanations = explanations;

    state = transitionStage(state, 'audit', ['explain']);
    const auditFlags = await auditProvision({
      bookIncome: currentTax.bookIncome.toString(),
      disclosedETR: etr.effectiveTaxRate.toString(),
      computedETR: etr.effectiveTaxRate.toString(),
      deferredTaxLines: deferredTax.lines as unknown as Array<Record<string, unknown>>,
      permanentDifferences: [],
      jurisdiction: state.jurisdiction as Jurisdiction,
    });
    state.auditFlags = auditFlags;

    state = transitionStage(state, 'review', ['audit']);
    state.humanReview = 'pending';

  } catch (err) {
    logger.error({ err, jobId: initial.jobId, stage: state.stage }, 'Agent pipeline failed');
    throw err;
  }

  return state;
}

const worker = new Worker<TaxProvisionState>(
  QUEUE_NAME,
  async (job: Job<TaxProvisionState>) => {
    logger.info({ jobId: job.id }, 'Agent pipeline started');
    const result = await processState(job.data);
    await job.updateProgress(100);
    logger.info({ jobId: job.id, stage: result.stage }, 'Agent pipeline completed');
    return result;
  },
  { connection },
);

export function startAgentPipelineWorker(): Worker {
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Agent pipeline job failed');
  });
  return worker;
}

export async function enqueueProvisionRun(
  jobId: string,
  jurisdiction: string,
  rawInput?: string,
): Promise<Job<TaxProvisionState>> {
  const state: TaxProvisionState = {
    jobId,
    jurisdiction,
    stage: 'parse',
    parsedItems: [],
    mappedItems: [],
    engineOutput: null,
    explanations: [],
    auditFlags: [],
    humanReview: 'pending',
    locked: false,
    rawInput,
  };

  return agentQueue.add(jobId, state, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}
