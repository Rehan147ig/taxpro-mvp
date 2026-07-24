/**
 * Audit Defense Subagent — Automated Tax Technical Memo Generator.
 *
 * Analyzes a completed provision run and generates audit-defensible
 * narratives for each significant book-tax difference, citing specific
 * IRC sections, Treasury Regulations, and ASC 740 guidance.
 *
 * Produces three deliverables:
 * 1. Executive Summary — plain-English overview of the provision
 * 2. ETR Walk — line-by-line explanation of each rate driver
 * 3. Technical Memos — per-difference support with IRC citations
 *
 * The output is structured so it can be inserted directly into a
 * workpaper package or audit response letter.
 */

import { callJsonModel } from '../../eve/model-client.js';
import { logger } from '../../lib/logger.js';

// ── Types ──

export interface AuditDefenseInput {
  entityName: string;
  period: string;
  bookIncome: number;
  effectiveTaxRate: number;
  statutoryRate: number;
  totalTaxExpense: number;
  currentTaxExpense: number;
  deferredTaxExpense: number;
  taxPayable: number;
  etrLines: Array<{
    description: string;
    amount: number;
    taxImpact: number;
    rateImpact: number;
  }>;
  permanentDifferences: Array<{
    label: string;
    amount: number;
  }>;
  temporaryDifferences: Array<{
    timingCategory: string;
    difference: number;
  }>;
  previousYearETR?: number;
  entities?: number;
  accountingMethod?: string;
  taxYear?: number;
}

export interface AuditDefenseResult {
  executiveSummary: string;
  etrWalk: ETRWalkLine[];
  technicalMemos: TechnicalMemo[];
  riskFlags: RiskFlag[];
  qualityScore: number;
}

export interface ETRWalkLine {
  description: string;
  amount: number;
  taxImpact: number;
  rateImpactPercent: number;
  narrative: string;
}

export interface TechnicalMemo {
  title: string;
  ircSection: string;
  bookTreatment: string;
  taxTreatment: string;
  amount: number;
  taxImpact: number;
  citation: string;
  narrative: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface RiskFlag {
  severity: 'low' | 'medium' | 'high';
  description: string;
  recommendation: string;
}

// ── System Prompt for Memo Generation ──

const AUDIT_DEFENSE_SYSTEM_PROMPT = `You are a senior tax manager at a Big 4 accounting firm drafting audit defense workpapers for an ASC 740 tax provision review. Your audience is the engagement partner and the IRS/tax authorities in the event of an audit.

You must write in a professional, technical-but-clear style. Each memo must include:
1. The specific IRC section and Treasury Regulation citation governing the treatment
2. The ASC 740 (formerly FAS 109) recognition and measurement guidance
3. The book vs tax treatment difference
4. Justification for the position taken
5. Risk assessment (low/medium/high) based on judicial authority and IRS guidance

For the ETR walk, explain each reconciling item from the statutory rate to the effective rate.
Flag any positions that have less than "substantial authority" (IRC Sec 6662) as high risk.

Output JSON format:
{
  executiveSummary: string,
  etrWalk: [{ description, amount, taxImpact, rateImpactPercent, narrative }],
  technicalMemos: [{ title, ircSection, bookTreatment, taxTreatment, amount, taxImpact, citation, narrative, riskLevel }],
  riskFlags: [{ severity, description, recommendation }],
  qualityScore: number (0-100)
}`;

// ── Main Execution ──

export async function draftAuditMemo(input: AuditDefenseInput): Promise<AuditDefenseResult> {
  logger.info({ entityName: input.entityName, period: input.period }, '[AuditDefense] Starting');

  try {
    const etrChangeNote = input.previousYearETR !== undefined
      ? `\nPrevious year ETR: ${(input.previousYearETR * 100).toFixed(2)}%. Change: ${((input.effectiveTaxRate - input.previousYearETR) * 100).toFixed(2)}%.`
      : '';

    const prompt = {
      entity: input.entityName,
      period: input.period,
      taxYear: input.taxYear ?? new Date(input.period).getFullYear(),
      accountingMethod: input.accountingMethod ?? 'accrual',
      entities: input.entities ?? 1,
      summary: {
        bookIncome: input.bookIncome,
        totalTaxExpense: input.totalTaxExpense,
        currentTaxExpense: input.currentTaxExpense,
        deferredTaxExpense: input.deferredTaxExpense,
        taxPayable: input.taxPayable,
        effectiveTaxRate: input.effectiveTaxRate,
        statutoryRate: input.statutoryRate,
      },
      etrReconciliation: input.etrLines,
      permanentDifferences: input.permanentDifferences,
      temporaryDifferences: input.temporaryDifferences,
      previousYearETR: input.previousYearETR,
    };

    const response = await callJsonModel<AuditDefenseResult>({
      system: AUDIT_DEFENSE_SYSTEM_PROMPT,
      user: `Draft audit defense workpapers for the following ASC 740 tax provision.${etrChangeNote}\n\nData:\n${JSON.stringify(prompt, null, 2)}`,
      promptVersion: 'audit-defense-v2',
      temperature: 0.2,
      maxTokens: 8192,
    });

    logger.info({ memos: response.parsed.technicalMemos?.length ?? 0, flags: response.parsed.riskFlags?.length ?? 0 }, '[AuditDefense] Complete');
    return response.parsed;

  } catch (err) {
    logger.error({ err }, '[AuditDefense] Failed');
    return {
      executiveSummary: `[Audit memo generation failed for ${input.entityName} — ${input.period}. Error: ${err instanceof Error ? err.message : 'Unknown'}]`,
      etrWalk: [],
      technicalMemos: [],
      riskFlags: [{
        severity: 'high',
        description: 'Automated memo generation failed',
        recommendation: 'Manually draft audit defense workpapers for this period.',
      }],
      qualityScore: 0,
    };
  }
}
