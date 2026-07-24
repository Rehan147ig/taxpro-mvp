/**
 * LLM prompt templates for the AI semantic account mapper.
 *
 * The mapper uses OpenAI's structured output (JSON mode) to classify
 * NetSuite chart of accounts entries into canonical tax categories.
 *
 * System prompt: establishes the domain context and rules
 * User prompt: provides the specific account data to classify
 */

export const SYSTEM_PROMPT = `You are an expert tax accountant specializing in US corporate income tax (ASC 740).
You classify general ledger accounts into tax categories based on their account name, number, and type.

RULES:
1. Determine if the account creates a permanent difference, temporary difference, or no difference between book and tax.
2. PERMANENT differences are items that are recognized differently for book vs tax and NEVER reverse (e.g., tax-exempt interest, non-deductible meals, penalties, life insurance proceeds).
3. TEMPORARY differences are items where the timing of recognition differs between book and tax but eventually reverse (e.g., depreciation methods, bad debt reserves, warranty reserves, deferred revenue).
4. NO DIFFERENCE means the account is treated identically for book and tax (e.g., cash, AR, AP, revenue, salaries, rent).
5. For temporary deductible differences (DTA), the tax deduction comes AFTER the book expense.
6. For temporary taxable differences (DTL), the tax income comes AFTER the book income.
7. When uncertain, prefer NO_DIFF over guessing a specific category.

You must respond with a JSON array of classifications, one per account.`;

export function buildUserPrompt(
  accounts: { id: string; accountNumber: string; name: string; type: string; detailType?: string }[],
): string {
  const accountLines = accounts.map((a) =>
    `ID: ${a.id} | #${a.accountNumber} | ${a.name} | Type: ${a.type}${a.detailType ? ` | Detail: ${a.detailType}` : ''}`
  ).join('\n');

  return `Classify the following chart of accounts into tax categories.\n\nAccounts:\n${accountLines}\n\nReturn a JSON array of objects with: accountId, taxAccountType, bookTreatment, timingCategory (if temporary), confidenceScore (0.0-1.0), and explanation.`;
}

/**
 * JSON Schema for structured output parsing.
 *
 * Each account gets classified into one of the canonical tax account types.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'The internal account ID from the input' },
          taxAccountType: {
            type: 'string',
            enum: [
              'PERM_MEALS_ENTERTAINMENT', 'PERM_PENALTIES_FINES', 'PERM_DIVIDENDS_RECEIVED_DEDUCTION',
              'PERM_LIFE_INSURANCE', 'PERM_TAX_EXEMPT_INTEREST', 'PERM_NONDEDUCTIBLE_GOODWILL',
              'PERM_OTHER', 'TEMP_DEPRECIATION', 'TEMP_AMORTIZATION', 'TEMP_ACCELERATED_DEPRECIATION',
              'TEMP_BONUS_DEPRECIATION', 'TEMP_SECTION_179', 'TEMP_RESEARCH_CREDIT',
              'TEMP_BAD_DEBT_RESERVE', 'TEMP_INVENTORY_RESERVE', 'TEMP_WARRANTY_RESERVE',
              'TEMP_DEFERRED_REVENUE', 'TEMP_ACCRUED_LIABILITIES', 'TEMP_PENSION',
              'TEMP_NOL_CARRYFORWARD', 'TEMP_TAX_CREDIT_CARRYFORWARD', 'TEMP_OTHER',
              'NODIFF_CASH', 'NODIFF_AR', 'NODIFF_AP', 'NODIFF_REVENUE', 'NODIFF_SALARIES',
              'NODIFF_RENT', 'NODIFF_UTILITIES', 'NODIFF_OTHER',
            ],
          },
          bookTreatment: {
            type: 'string',
            enum: ['permanent', 'temporary', 'no_diff'],
          },
          timingCategory: {
            type: 'string',
            enum: ['deductible_temporary', 'taxable_temporary'],
            description: 'Required only when bookTreatment is temporary. deductible = DTA, taxable = DTL.',
          },
          confidenceScore: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'How confident you are in this classification (0.0 = guessing, 1.0 = certain based on name)',
          },
          explanation: {
            type: 'string',
            description: 'Brief reason for this classification in plain English',
          },
        },
        required: ['accountId', 'taxAccountType', 'bookTreatment', 'confidenceScore', 'explanation'],
      },
    },
  },
  required: ['mappings'],
};
