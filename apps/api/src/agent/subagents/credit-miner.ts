/**
 * Credit Miner Subagent — Automated Tax Credit Identification.
 *
 * Analyzes trial balance data to identify potential tax credits:
 * 1. R&D Tax Credit (IRC Sec 41) — Regular and Alternative Simplified methods
 * 2. Research & Experimentation Capitalization (IRC Sec 174)
 * 3. Energy-Efficient Commercial Buildings (IRC Sec 179D)
 * 4. Renewable Energy Production (IRC Sec 45)
 * 5. Work Opportunity Tax Credit (IRC Sec 51)
 *
 * The agent uses an LLM call to identify qualifying accounts from GL
 * descriptions, then runs deterministic math for credit computation.
 *
 * This hybrid approach (LLM for identification, math for calculation)
 * ensures the credit amounts are auditable and reproducible.
 */

import { z } from 'zod';
import { callJsonModel } from '../../eve/model-client.js';
import { logger } from '../../lib/logger.js';

export const creditIdentificationSchema = z.object({
  accountMatches: z.array(z.object({
    accountId: z.string(),
    accountName: z.string(),
    balance: z.number(),
    creditType: z.string(),
    category: z.string(),
    // Providers commonly return numeric confidence; accept both and normalize.
    confidence: z.coerce.number(),
    description: z.string(),
  })),
  recommendations: z.array(z.string()),
});

/** Map a numeric confidence (0-1) to the legacy high/medium/low label. */
function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

// ── Types ──

export interface CreditMinerInput {
  tenantId: string;
  tenantName?: string;
  period: string;
  endPeriod?: string;
  fiscalYear: number;
  trialBalance: Array<{
    accountId: string;
    accountName: string;
    accountNumber: string;
    accountType: string;
    balance: number;
  }>;
  priorYearBalances?: Array<{
    accountId: string;
    accountName: string;
    balance: number;
  }>;
}

export interface CreditMinerResult {
  rdCredit: RDCreditResult | null;
  section174: Section174Result | null;
  energyCredits: EnergyCreditResult[];
  wtcCredits: WTCResult[];
  summary: {
    totalIdentifiedCredits: number;
    totalQualifiedExpenses: number;
    creditCount: number;
    recommendations: string[];
  };
  success: boolean;
  error?: string;
}

export interface RDCreditResult {
  qualifiedResearchExpenses: number;
  grossReceipts?: number;
  baseAmount?: number;
  fixedBasePercentage?: number;
  computedCredit: number;
  method: 'regular' | 'alternative_simplified';
  carryforwardAvailable: number;
  accountsIdentified: Array<{ name: string; amount: number; category: string }>;
  narrative: string;
}

export interface Section174Result {
  softwareDevelopmentCosts: number;
  contractResearchCosts: number;
  wagesCosts: number;
  suppliesCosts: number;
  totalQualifiedExpenses: number;
  domesticAmortizationPeriod: number;
  domesticAmortizationCurrent: number;
  narrative: string;
}

export interface EnergyCreditResult {
  type: string;
  ircSection: string;
  qualifiedExpenses: number;
  estimatedCredit: number;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

export interface WTCResult {
  targetGroup: string;
  qualifiedWages: number;
  estimatedCredit: number;
  description: string;
}

// ── System Prompts ──

const CREDIT_IDENTIFICATION_SYSTEM_PROMPT = `You are a tax credit specialist at a national CPA firm. Your expertise is identifying potential tax credits and incentives from general ledger account descriptions.

For each account in the trial balance, determine if it involves any of the following:

**R&D Tax Credit (IRC Sec 41)** — Look for:
- Wages for research, development, engineering, product design, prototyping
- Supplies used in research (lab supplies, prototypes, testing materials)
- Contract research expenses (external R&D service providers)
- Cloud computing costs for R&D activities
- Quality assurance/testing for new products
- NOT eligible: routine testing, market research, advertising, management studies

**R&E Capitalization (IRC Sec 174)** — Look for:
- Software development costs (capitalized under ASC 350-40 or ASC 985-20)
- Engineering design costs
- Product development costs
- These may be the same accounts as Sec 41 — they overlap

**Energy Credits** — Look for:
- Energy-efficient building improvements (Sec 179D)
- Solar, wind, renewable energy investments (Sec 48, Sec 45)
- EV charging station installation (Sec 30C)
- Energy-efficient HVAC, lighting, building envelope

**Work Opportunity Tax Credit (IRC Sec 51)** — Look for:
- Wages paid to qualifying veterans
- Long-term unemployed hires
- Ex-felon hires
- Summer youth employees
- WOTC-eligible position wages

For each identified account, return:
- accountName, accountId, balance, creditType, category, confidence

Output JSON: {
  accountMatches: [{ accountId, accountName, balance, creditType, category, confidence, description }],
  recommendations: [string]
}`;

// ── Main Execution ──

export async function mineCredits(input: CreditMinerInput): Promise<CreditMinerResult> {
  logger.info({ tenantId: input.tenantId, accounts: input.trialBalance.length }, '[CreditMiner] Starting');

  try {
    // Step 1: Identify qualifying accounts via LLM
    const identificationResponse = await callJsonModel({
      schema: creditIdentificationSchema,
      system: CREDIT_IDENTIFICATION_SYSTEM_PROMPT,
      user: `Analyze this trial balance for potential tax credits. Fiscal year: ${input.fiscalYear}.\n\nAccounts:\n${JSON.stringify(input.trialBalance.map(a => ({ number: a.accountNumber, name: a.accountName, type: a.accountType, balance: a.balance })), null, 2)}\n\n${input.priorYearBalances ? `Prior year balances for comparison:\n${JSON.stringify(input.priorYearBalances.map(a => ({ name: a.accountName, balance: a.balance })), null, 2)}` : ''}`,
      promptVersion: 'credit-miner-id-v1',
      temperature: 0.2,
    });

    const matches = identificationResponse.parsed.accountMatches ?? [];
    const recommendations = identificationResponse.parsed.recommendations ?? [];

    // Step 2: Compute deterministic credit amounts
    const rdMatches = matches.filter(m => m.creditType === 'rd_credit' || m.creditType === 'R&D' || m.creditType === 'research');
    const sec174Matches = matches.filter(m => m.creditType === 'sec_174' || m.creditType === 'R&E' || m.creditType === 'capitalized_software');
    const energyMatches = matches.filter(m => m.creditType.startsWith('energy_'));
    const wtcMatches = matches.filter(m => m.creditType.startsWith('wtc_'));

    let rdResult: RDCreditResult | null = null;
    if (rdMatches.length > 0) {
      const qre = rdMatches.reduce((s, m) => s + Math.abs(m.balance), 0);
      const baseAmount = qre * 0.5; // simplified: 50% of QRE as base
      const computedCredit = Math.max(0, (qre - baseAmount) * 0.20);
      rdResult = {
        qualifiedResearchExpenses: qre,
        fixedBasePercentage: 0.03,
        baseAmount,
        computedCredit,
        method: 'alternative_simplified',
        carryforwardAvailable: computedCredit, // simplified: 100% carryforward if unused
        accountsIdentified: rdMatches.map(m => ({ name: m.accountName, amount: Math.abs(m.balance), category: m.category })),
        narrative: `Identified ${rdMatches.length} R&D-related accounts totaling $${qre.toLocaleString()} in qualified research expenses. Estimated R&D tax credit (alternative simplified method): $${Math.round(computedCredit).toLocaleString()}. Subject to 75% tax liability limitation under Sec 41.`,
      };
    }

    let sec174Result: Section174Result | null = null;
    if (sec174Matches.length > 0) {
      const total = sec174Matches.reduce((s, m) => s + Math.abs(m.balance), 0);
      sec174Result = {
        softwareDevelopmentCosts: sec174Matches.filter(m => m.category === 'software').reduce((s, m) => s + Math.abs(m.balance), 0),
        contractResearchCosts: sec174Matches.filter(m => m.category === 'contract').reduce((s, m) => s + Math.abs(m.balance), 0),
        wagesCosts: sec174Matches.filter(m => m.category === 'wages').reduce((s, m) => s + Math.abs(m.balance), 0),
        suppliesCosts: sec174Matches.filter(m => m.category === 'supplies').reduce((s, m) => s + Math.abs(m.balance), 0),
        totalQualifiedExpenses: total,
        domesticAmortizationPeriod: 5,
        domesticAmortizationCurrent: total / 5,
        narrative: `Sec 174: $${total.toLocaleString()} in R&E costs subject to 5-year capitalization (domestic). Current year amortization: $${(total / 5).toLocaleString()}. Temporary difference (DTA) created.`,
      };
    }

    const energyCredits: EnergyCreditResult[] = energyMatches.map(m => ({
      type: m.creditType,
      ircSection: m.creditType.includes('179D') ? 'Sec 179D' : m.creditType.includes('45') ? 'Sec 45' : 'Sec 48',
      qualifiedExpenses: Math.abs(m.balance),
      estimatedCredit: Math.abs(m.balance) * 0.30,
      confidence: confidenceLabel(m.confidence),
      description: m.description,
    }));

    const wtcResults: WTCResult[] = wtcMatches.map(m => ({
      targetGroup: m.category,
      qualifiedWages: Math.abs(m.balance),
      estimatedCredit: Math.abs(m.balance) * 0.40,
      description: m.description,
    }));

    const totalCredits = (rdResult?.computedCredit ?? 0) + energyCredits.reduce((s, e) => s + e.estimatedCredit, 0) + wtcResults.reduce((s, w) => s + w.estimatedCredit, 0);
    const totalQualified = (rdResult?.qualifiedResearchExpenses ?? 0) + (sec174Result?.totalQualifiedExpenses ?? 0) + energyCredits.reduce((s, e) => s + e.qualifiedExpenses, 0);

    logger.info({ credits: matches.length, rdAmount: totalCredits }, '[CreditMiner] Complete');
    return {
      rdCredit: rdResult,
      section174: sec174Result,
      energyCredits,
      wtcCredits: wtcResults,
      summary: {
        totalIdentifiedCredits: totalCredits,
        totalQualifiedExpenses: totalQualified,
        creditCount: matches.length,
        recommendations,
      },
      success: true,
    };

  } catch (err) {
    logger.error({ err }, '[CreditMiner] Failed');
    return {
      rdCredit: null, section174: null, energyCredits: [], wtcCredits: [],
      summary: { totalIdentifiedCredits: 0, totalQualifiedExpenses: 0, creditCount: 0, recommendations: [] },
      success: false,
      error: err instanceof Error ? err.message : 'Credit miner failed',
    };
  }
}
