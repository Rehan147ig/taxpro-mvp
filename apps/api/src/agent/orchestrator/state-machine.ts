import Decimal from 'decimal.js';
import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { parseTrialBalance } from '../parser/parser-agent.js';
import { classifyAccounts } from '../mapping/mapping-agent.js';
import { generateExplanation } from '../explanation/explanation-agent.js';
import { auditProvision } from '../audit/audit-agent.js';
import { createEngine, Jurisdiction, etrAdjustmentsForMarginalRelief } from '@taxpro/tax-engine';
import type { TaxProvisionState, PipelineStage } from '../../state/tax-provision-state.js';
import type { BookTaxDifference, TrialBalanceLine, Account, TaxMapping, TaxAccountType, PermanentDifferenceItem } from '@taxpro/tax-engine';
import { assertNotLocked, transitionStage } from '../../state/tax-provision-state.js';
import { logger } from '../../lib/logger.js';

const QUEUE_NAME = 'taxpro-agent-pipeline';
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

export const agentQueue = new Queue<TaxProvisionState>(QUEUE_NAME, { connection });

const STAGE_ORDER: PipelineStage[] = ['parse', 'map', 'calculate', 'explain', 'audit', 'review'];

function buildBookTaxDifferences(
  state: TaxProvisionState,
  engine: ReturnType<typeof createEngine>,
): BookTaxDifference[] {
  const trialBalance: TrialBalanceLine[] = state.parsedItems.map(p => ({
    entityId: p.entityId,
    accountId: p.accountNumber,
    period: p.period,
    balance: new Decimal(p.balance),
  }));

  const accounts: Account[] = state.parsedItems.map(p => ({
    id: p.accountNumber,
    accountNumber: p.accountNumber,
    name: p.accountName,
    type: p.accountType,
  }));

  const taxMappings = new Map<string, TaxMapping>();
  for (const m of state.mappedItems) {
    taxMappings.set(m.accountNumber, {
      accountId: m.accountNumber,
      taxAccountType: m.taxAccountType as TaxAccountType,
      bookTreatment: m.bookTreatment,
      timingCategory: m.timingCategory as TaxMapping['timingCategory'],
      confidenceScore: new Decimal(m.confidenceScore),
    });
  }

  const period = state.parsedItems[0]?.period ?? new Date().toISOString().slice(0, 7);
  return engine.computeBookTaxDifferences(trialBalance, accounts, taxMappings, period);
}

function buildPermanentDifferences(
  state: TaxProvisionState,
): PermanentDifferenceItem[] {
  return state.mappedItems
    .filter(m => m.bookTreatment === 'permanent')
    .map(m => {
      const p = state.parsedItems.find(p => p.accountNumber === m.accountNumber);
      if (!p) {
        throw new Error(`No parsed item found for mapped account ${m.accountNumber}`);
      }
      return {
        amount: new Decimal(p.balance),
        label: m.taxAccountType,
      };
    });
}

/** Returns Profit Before Tax = ΣIncome - ΣExpense (positive = profit).
 *  Uses abs() on each balance so the result is deterministic regardless
 *  of whether the LLM parser stored expenses as positive or negative strings. */
function computeBookIncome(state: TaxProvisionState): Decimal {
  let income = new Decimal(0);
  let expense = new Decimal(0);
  for (const p of state.parsedItems) {
    if (p.accountType === 'Income') {
      income = income.plus(new Decimal(p.balance).abs());
    } else if (p.accountType === 'Expense') {
      expense = expense.plus(new Decimal(p.balance).abs());
    }
  }
  return income.minus(expense);
}

function resolvePeriod(state: TaxProvisionState): string {
  return state.parsedItems[0]?.period ?? new Date().toISOString().slice(0, 10);
}

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
    const engine = createEngine(state.jurisdiction as Jurisdiction);
    const period = resolvePeriod(state);
    const fiscalYear = period.slice(0, 4);
    const bookIncome = computeBookIncome(state);
    const permanentDifferences = buildPermanentDifferences(state);
    const allDiffs = buildBookTaxDifferences(state, engine);
    const temporaryDifferences = allDiffs.filter(d => d.diffType === 'temporary');

    const taxRate = engine.getRateForFiscalYear(fiscalYear);
    const currentTax = engine.calculateCurrentTax({
      bookIncome,
      permanentDifferences,
      taxRate,
      taxCredits: new Decimal(0),
      estimatedPayments: new Decimal(0),
      nolUtilization: new Decimal(0),
      asOfDate: period,
    });
    const deferredTax = engine.calculateDeferredTax(
      temporaryDifferences,
      {},
      {},
      {},
      undefined,
      period,
    );
    const etr = engine.calculateETR({
      bookIncome: currentTax.bookIncome,
      federalTaxRate: currentTax.federalTaxRate,
      federalTax: currentTax.federalTax,
      stateTax: currentTax.stateTax,
      permanentDifferences,
      taxCredits: currentTax.taxCredits,
      otherAdjustments: etrAdjustmentsForMarginalRelief(currentTax),
    });
    state.engineOutput = {
      currentTax: currentTax as unknown as Record<string, unknown>,
      deferredTax: deferredTax as unknown as Record<string, unknown>,
      etr: etr as unknown as Record<string, unknown>,
    };

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
      permanentDifferences: permanentDifferences as unknown as Array<Record<string, unknown>>,
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
