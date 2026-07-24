/**
 * Mapping Agent — Two-Stage ASC 740 Classification.
 *
 * Stage 1: Account Type Detection
 *   Determines if an account is COGS, Operating Expense, SG&A, Revenue, or Other.
 *   This matters because COGS vs Operating Expense changes the ETR presentation.
 *
 * Stage 2: IRC Tax Category Mapping
 *   Maps each account to a canonical tax treatment with IRC section citations:
 *   - Sec 274(n) — 50% meals & entertainment limitation
 *   - Sec 162(f) — Non-deductible penalties & fines
 *   - Sec 174 — R&D capitalization/amortization
 *   - Sec 167/168 — MACRS depreciation
 *   - Sec 101(a) — Life insurance proceeds exclusion
 *   - Sec 243 — Dividends-received deduction
 *   - etc.
 *
 * Each stage uses a focused LLM call so the model doesn't have to juggle
 * both decisions simultaneously, improving accuracy.
 */

import { callJsonModel } from '../../eve/model-client.js';
import { findSimilarPatterns } from '../../eve/pattern-store.js';
import { logger } from '../../lib/logger.js';

// ── Types ──

export interface MappingAgentInput {
  tenantId: string;
  tenantName?: string;
  accounts: Array<{
    id: string;
    accountNumber: string;
    name: string;
    type: string;
    detailType?: string;
    netBalance?: number;
  }>;
}

export interface MappingAgentResult {
  typeClassifications: Array<{
    accountId: string;
    functionalCategory: 'cogs' | 'operating_expense' | 'sga' | 'revenue' | 'other_income' | 'other_expense' | 'balance_sheet';
    confidence: number;
    reasoning: string;
  }>;
  taxMappings: Array<{
    accountId: string;
    taxAccountType: string;
    bookTreatment: 'permanent' | 'temporary' | 'no_diff';
    timingCategory?: 'deductible_temporary' | 'taxable_temporary';
    confidenceScore: number;
    ircSection: string;
    explanation: string;
  }>;
  success: boolean;
  error?: string;
}

// ── Stage 1: IRC Tax Category Mapping System Prompt ──

const IRC_MAPPING_SYSTEM_PROMPT = `You are an expert in US corporate income tax (IRC and ASC 740). Your role is to map general ledger accounts to specific IRC tax categories.

For each account, determine:
1. The correct taxAccountType (canonical category from the list below)
2. Whether it creates a permanent difference, temporary difference, or no difference between book and tax
3. If temporary, the timing category (deductible_temporary = DTA, taxable_temporary = DTL)
4. The specific IRC section that governs this treatment
5. A confidence score (0.0-1.0)
6. A brief explanation

PERMANENT differences (IRC sections where book and tax treatment differ permanently):
- PERM_MEALS_ENTERTAINMENT — Sec 274(n): 50% of meals non-deductible
- PERM_PENALTIES_FINES — Sec 162(f): Government fines and penalties non-deductible
- PERM_LIFE_INSURANCE — Sec 101(a): Key-person life insurance proceeds tax-exempt
- PERM_TAX_EXEMPT_INTEREST — Sec 103: Municipal bond interest tax-exempt
- PERM_DIVIDENDS_RECEIVED_DEDUCTION — Sec 243: DRD allows 50-65% deduction
- PERM_NONDEDUCTIBLE_GOODWILL — Sec 197: Goodwill impairment not deductible for tax
- PERM_OTHER — Other permanent items

TEMPORARY differences (timing differences that reverse):
- TEMP_DEPRECIATION — Sec 167/168: Book SL vs MACRS depreciation
- TEMP_ACCELERATED_DEPRECIATION — Sec 168(k): Bonus depreciation
- TEMP_BONUS_DEPRECIATION — Sec 168(k): 80% bonus (2023-2027)
- TEMP_SECTION_179 — Sec 179: Immediate expensing election
- TEMP_AMORTIZATION — Sec 197: Intangible amortization
- TEMP_RESEARCH_CAPITALIZATION — Sec 174: R&D costs capitalized 5yr/15yr
- TEMP_BAD_DEBT_RESERVE — Sec 166: Reserve method vs specific charge-off
- TEMP_DEFERRED_REVENUE — Sec 451: Revenue recognition timing
- TEMP_ACCRUED_LIABILITIES — Sec 461: Economic performance test
- TEMP_WARRANTY_RESERVE — Sec 461: Warranty accruals
- TEMP_NOL_CARRYFORWARD — Sec 172: NOL carryforward (80% limit)
- TEMP_OTHER — Other temporary items

NO DIFFERENCE (treated identically for book and tax):
- NODIFF_CASH, NODIFF_AR, NODIFF_AP, NODIFF_REVENUE, NODIFF_SALARIES
- NODIFF_RENT, NODIFF_UTILITIES, NODIFF_OTHER

Return JSON: { mappings: [{ accountId, taxAccountType, bookTreatment, timingCategory?, confidenceScore, ircSection, explanation }] }`;

// ── Stage 1: Functional Category Detection ──

const TYPE_CLASSIFICATION_PROMPT = `You are a cost accounting expert. Your role is to classify general ledger accounts into their functional income statement category.

For each account, determine which bucket it belongs to:
- **cogs** — Cost of Goods Sold / Cost of Revenue: Direct costs of delivering the product/service (cloud hosting, direct labor, materials, software licenses, shipping, fulfillment)
- **operating_expense** — Operating Expenses: R&D, engineering costs (not direct labor), product development, quality assurance
- **sga** — Selling, General & Administrative: Sales commissions, marketing, office rent, salaries for non-production staff, legal, accounting, insurance, facilities, IT
- **revenue** — Revenue accounts (subscriptions, services, interest income)
- **other_income** — Non-operating income (dividends, gains)
- **other_expense** — Non-operating expense (interest expense, losses)
- **balance_sheet** — Balance sheet only (assets, liabilities, equity)

Return JSON: { classifications: [{ accountId, functionalCategory, confidence, reasoning }] }`;

// ── Main Execution ──

export async function runMappingAgent(input: MappingAgentInput): Promise<MappingAgentResult> {
  logger.info({ tenantId: input.tenantId, accounts: input.accounts.length }, '[MappingAgent] Starting');

  try {
    // Stage 1: Functional category detection
    const stage1Accounts = input.accounts.map(a => ({
      id: a.id,
      number: a.accountNumber,
      name: a.name,
      type: a.type,
      detailType: a.detailType,
      balance: a.netBalance,
    }));

    const typeResponse = await callJsonModel<{ classifications: Array<{
      accountId: string; functionalCategory: string; confidence: number; reasoning: string;
    }> }>({
      system: TYPE_CLASSIFICATION_PROMPT,
      user: `Classify these accounts by functional category:\n${JSON.stringify(stage1Accounts, null, 2)}`,
      promptVersion: 'mapping-agent-stage1-v1',
      temperature: 0.1,
    });
    const typeClassifications = (typeResponse.parsed.classifications ?? []).map(c => ({
      accountId: c.accountId,
      functionalCategory: c.functionalCategory as any,
      confidence: c.confidence,
      reasoning: c.reasoning,
    }));

    // Stage 2: IRC tax category mapping (with historical pattern context)
    const patternLines: string[] = [];
    const seen = new Set<string>();
    for (const a of input.accounts) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      const patterns = await findSimilarPatterns(input.tenantId, a.name, a.type, 2);
      for (const p of patterns) {
        patternLines.push(`"${p.pattern.accountName}" → ${p.pattern.mappedType} (${p.pattern.bookTreatment}) [${p.pattern.resolution}]`);
      }
    }
    const historical = patternLines.length > 0 ? `\n\nHistorical CPA override patterns for similar accounts:\n${patternLines.join('\n')}` : '';
    const stage2Accounts = input.accounts.map(a => ({
      id: a.id,
      number: a.accountNumber,
      name: a.name,
      type: a.type,
      detailType: a.detailType,
      functionalCategory: typeClassifications.find(c => c.accountId === a.id)?.functionalCategory ?? 'unknown',
    }));

    const mappingResponse = await callJsonModel<{ mappings: Array<{
      accountId: string; taxAccountType: string; bookTreatment: string;
      timingCategory?: string; confidenceScore: number; ircSection: string; explanation: string;
    }> }>({
      system: IRC_MAPPING_SYSTEM_PROMPT,
      user: `Map these accounts to IRC tax categories. Include the specific IRC section for each.${historical}\n\nAccounts:\n${JSON.stringify(stage2Accounts, null, 2)}`,
      promptVersion: 'mapping-agent-stage2-v2',
      temperature: 0.1,
    });

    const taxMappings = (mappingResponse.parsed.mappings ?? []).map(m => ({
      accountId: m.accountId,
      taxAccountType: m.taxAccountType,
      bookTreatment: m.bookTreatment as any,
      timingCategory: m.timingCategory as any,
      confidenceScore: m.confidenceScore,
      ircSection: m.ircSection,
      explanation: m.explanation,
    }));

    logger.info({ typeClassifications: typeClassifications.length, taxMappings: taxMappings.length }, '[MappingAgent] Complete');
    return { typeClassifications, taxMappings, success: true };

  } catch (err) {
    logger.error({ err }, '[MappingAgent] Failed');
    return { typeClassifications: [], taxMappings: [], success: false, error: err instanceof Error ? err.message : 'Mapping agent failed' };
  }
}
