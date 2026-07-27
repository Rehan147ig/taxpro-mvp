import { z } from 'zod';
import { callJsonModel } from '../../../eve/model-client.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt-templates.js';

/**
 * AI Semantic Account Mapper.
 *
 * Uses LLM structured output (Vercel AI SDK generateObject) to classify
 * NetSuite accounts into canonical tax categories. Works with any
 * OpenAI-compatible provider (OpenAI, NVIDIA, GLM, etc.) by reading
 * AI_PROVIDER / AI_BASE_URL / AI_MODEL from env.
 *
 * Flow:
 * 1. Build system prompt with tax domain context
 * 2. Send account data in batches (50 per call)
 * 3. Receive zod-validated structured mappings from the LLM
 * 4. Return typed mappings with confidence scores
 */

const BATCH_SIZE = 50; // Accounts per LLM call

const mappingBatchSchema = z.object({
  mappings: z.array(z.object({
    accountId: z.string(),
    taxAccountType: z.string(),
    bookTreatment: z.enum(['permanent', 'temporary', 'no_diff']),
    timingCategory: z.enum(['deductible_temporary', 'taxable_temporary']).optional(),
    confidenceScore: z.number(),
    explanation: z.string(),
  })),
});

export interface AIMappingResult {
  accountId: string;
  taxAccountType: string;
  bookTreatment: 'permanent' | 'temporary' | 'no_diff';
  timingCategory?: 'deductible_temporary' | 'taxable_temporary';
  confidenceScore: number;
  explanation: string;
}

export interface AIMappingInput {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  detailType?: string;
}

/**
 * Classify accounts using the configured AI provider.
 */
export async function classifyAccountsAI(
  accounts: AIMappingInput[],
): Promise<AIMappingResult[]> {
  const allResults: AIMappingResult[] = [];

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch);
    allResults.push(...batchResults);
  }

  return allResults;
}

async function classifyBatch(
  accounts: AIMappingInput[],
): Promise<AIMappingResult[]> {
  const response = await callJsonModel({
    schema: mappingBatchSchema,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(accounts),
    promptVersion: 'ai-mapper-v2',
    temperature: 0.1,
  });

  return response.parsed.mappings;
}

// ── Rule-based fallback (used when no LLM is available) ──

export function fallbackClassify(accounts: AIMappingInput[]): AIMappingResult[] {
  return accounts.map((a) => ({ accountId: a.id, ...classifyByRule(a) }));
}

function classifyByRule(account: AIMappingInput): Omit<AIMappingResult, 'accountId'> {
  const name = account.name.toLowerCase();
  const type = account.type.toLowerCase();

  if (name.includes('cash') || account.detailType === 'Bank')
    return { taxAccountType: 'NODIFF_CASH', bookTreatment: 'no_diff', confidenceScore: 0.95, explanation: 'Cash — no book-tax difference' };

  if (name.includes('receivable') || name === 'ar')
    return { taxAccountType: 'NODIFF_AR', bookTreatment: 'no_diff', confidenceScore: 0.95, explanation: 'Receivables — no book-tax difference' };

  if (name.includes('payable') || name === 'ap')
    return { taxAccountType: 'NODIFF_AP', bookTreatment: 'no_diff', confidenceScore: 0.95, explanation: 'Payables — no book-tax difference' };

  if (type === 'income')
    return { taxAccountType: 'NODIFF_REVENUE', bookTreatment: 'no_diff', confidenceScore: 0.90, explanation: 'Revenue — recognized the same for book and tax' };

  if (name.includes('salary') || name.includes('wage') || name.includes('payroll'))
    return { taxAccountType: 'NODIFF_SALARIES', bookTreatment: 'no_diff', confidenceScore: 0.90, explanation: 'Salaries — deductible in the same period' };

  if (name.includes('depreciation') || name.includes('amortization'))
    return {
      taxAccountType: name.includes('amortization') ? 'TEMP_AMORTIZATION' : 'TEMP_DEPRECIATION',
      bookTreatment: 'temporary',
      timingCategory: 'taxable_temporary',
      confidenceScore: 0.70,
      explanation: 'Depreciation methods differ (book SL vs tax MACRS) — temporary difference',
    };

  if (name.includes('bad debt') || name.includes('doubtful') || name.includes('allowance'))
    return {
      taxAccountType: 'TEMP_BAD_DEBT_RESERVE',
      bookTreatment: 'temporary',
      timingCategory: 'deductible_temporary',
      confidenceScore: 0.75,
      explanation: 'Bad debt reserve is booked before it becomes tax-deductible',
    };

  if (name.includes('meal') || name.includes('entertainment'))
    return { taxAccountType: 'PERM_MEALS_ENTERTAINMENT', bookTreatment: 'permanent', confidenceScore: 0.80, explanation: 'Meals are partially non-deductible for tax' };

  if (name.includes('penalty') || name.includes('fine'))
    return { taxAccountType: 'PERM_PENALTIES_FINES', bookTreatment: 'permanent', confidenceScore: 0.85, explanation: 'Penalties are non-deductible for tax' };

  if (name.includes('research') || name.includes('development') || name.includes('engineering'))
    return {
      taxAccountType: 'TEMP_RESEARCH_CREDIT',
      bookTreatment: 'temporary',
      timingCategory: 'deductible_temporary',
      confidenceScore: 0.65,
      explanation: 'R&D costs may be capitalized for tax vs expensed for book',
    };

  return { taxAccountType: 'NODIFF_OTHER', bookTreatment: 'no_diff', confidenceScore: 0.50, explanation: 'Default — no book-tax difference expected' };
}
