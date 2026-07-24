import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { callJsonModel } from '../eve/model-client.js';
import { findSimilarPatterns } from '../eve/pattern-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS = readFileSync(join(__dirname, 'instructions.md'), 'utf-8');

export interface AgentInput {
  tenantId: string;
  tenantName?: string;
  period: string;
  endPeriod?: string;
  entityId?: string;
  federalRate: number;
  stateRate?: number;
  trialBalance: Array<{
    accountId: string;
    accountName: string;
    accountNumber: string;
    accountType: string;
    netBalance: number;
  }>;
  mappings: Array<{
    accountId: string;
    taxAccountType: string;
    bookTreatment: string;
    timingCategory?: string | null;
    confidenceScore: number;
    explanation?: string | null;
  }>;
}

export interface AgentResult {
  reasoning: string;
  totalRevenue: number;
  totalExpenses: number;
  bookIncome: number;
  permanentDifferences: Array<{ accountId: string; label: string; amount: number }>;
  temporaryDifferences: Array<{
    accountId: string; entityId: string; period: string;
    bookBalance: number; taxBalance: number; difference: number;
    diffType: 'temporary'; timingCategory: string;
  }>;
  success: boolean;
  error?: string;
}

/**
 * Eve agent — analyzes trial balance data and tax mappings to classify
 * book-tax differences using the LLM. Deterministic math is handled
 * by the route calling @taxpro/tax-engine.
 *
 * Uses a single LLM call (not multi-step tool calling) since GLM-5.2
 * handles structured JSON output reliably.
 */
export async function analyzeProvision(input: AgentInput): Promise<AgentResult> {
  logger.info({ tenantId: input.tenantId, accounts: input.trialBalance.length }, '[Eve] Analyzing provision');

  // Look up historical override patterns for similar accounts
  const patternLines: string[] = [];
  const seenAccounts = new Set<string>();

  for (const tb of input.trialBalance) {
    if (seenAccounts.has(tb.accountName)) continue;
    seenAccounts.add(tb.accountName);

    const patterns = await findSimilarPatterns(input.tenantId, tb.accountName, tb.accountType, 2);
    for (const p of patterns) {
      patternLines.push(
        `Historical: "${p.pattern.accountName}" → ${p.pattern.mappedType} (${p.pattern.bookTreatment}) [${p.pattern.resolution}, confidence was ${p.pattern.originalConfidence}]`
      );
    }
  }

  const accountsList = input.trialBalance.map(a =>
    `#${a.accountNumber} ${a.accountName} (${a.accountType}): bal=${a.netBalance}`
  ).join('\n');

  const mappingsList = input.mappings.map(m =>
    `accountId=${m.accountId} type=${m.taxAccountType} treatment=${m.bookTreatment}${m.timingCategory ? ` timing=${m.timingCategory}` : ''} score=${m.confidenceScore}`
  ).join('\n');

  const historicalContext = patternLines.length > 0
    ? `\n\nHistorical Override Patterns (from CPA review decisions):\n${patternLines.join('\n')}\n\nUse these patterns to inform your classification. If a similar account was previously overridden to a different type, consider whether the same logic applies.`
    : '';

  const prompt = `Analyze this trial balance and classify book-tax differences.

Trial Balance:
${accountsList}

Tax Mappings:
${mappingsList}
${historicalContext}

${input.stateRate ? `Tax rates: Federal ${(input.federalRate * 100).toFixed(1)}%, State ${(input.stateRate * 100).toFixed(1)}%` : `Tax rate: ${(input.federalRate * 100).toFixed(1)}%`}

Rules:
- Total revenue = sum of |netBalance| for Income-type accounts
- Total expenses = sum of |netBalance| for Expense-type accounts including COGS
- Book income = totalRevenue - totalExpenses
- Permanent differences: accounts with bookTreatment='permanent', use netBalance as amount
- Temporary differences: accounts with bookTreatment='temporary', use netBalance as bookBalance, 0 as taxBalance, netBalance as difference
- Use accountId from the account data, not the mapping

Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON. The JSON must have: reasoning (string), totalRevenue (number), totalExpenses (number), bookIncome (number), permanentDifferences (array of {accountId, label, amount}), temporaryDifferences (array of {accountId, bookBalance, taxBalance, difference, timingCategory}).`;

  try {
    const response = await callJsonModel<any>({
      system: INSTRUCTIONS,
      user: prompt,
      promptVersion: 'eve-provision-analysis-v1',
      temperature: 0.1,
      maxTokens: 4096,
    });

    const parsed = response.parsed;
    const result: AgentResult = {
      reasoning: parsed.reasoning ?? '',
      totalRevenue: Number(parsed.totalRevenue ?? 0),
      totalExpenses: Number(parsed.totalExpenses ?? 0),
      bookIncome: Number(parsed.bookIncome ?? 0),
      permanentDifferences: (parsed.permanentDifferences ?? []).map((pd: any) => ({
        accountId: pd.accountId,
        label: pd.label ?? pd.taxAccountType ?? 'Perm Diff',
        amount: Number(pd.amount ?? 0),
      })),
      temporaryDifferences: (parsed.temporaryDifferences ?? []).map((td: any) => ({
        accountId: td.accountId,
        entityId: input.entityId ?? 'consolidated',
        period: input.period,
        bookBalance: Number(td.bookBalance ?? 0),
        taxBalance: Number(td.taxBalance ?? 0),
        difference: Number(td.difference ?? 0),
        diffType: 'temporary' as const,
        timingCategory: td.timingCategory ?? 'TEMP_OTHER',
      })),
      success: true,
    };

    logger.info({ bookIncome: result.bookIncome, perms: result.permanentDifferences.length, temps: result.temporaryDifferences.length }, '[Eve] Analysis complete');
    return result;
  } catch (err) {
    logger.error({ err }, '[Eve] Analysis failed');
    return { ...emptyResult(input), success: false, error: err instanceof Error ? err.message : 'Provision analysis failed' };
  }
}

function emptyResult(input: AgentInput): AgentResult {
  return {
    reasoning: '', totalRevenue: 0, totalExpenses: 0, bookIncome: 0,
    permanentDifferences: [], temporaryDifferences: [],
    success: false,
  };
}
