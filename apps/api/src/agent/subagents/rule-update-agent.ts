/**
 * Rule Update Agent — the extraction half of the agentic rule-refresh loop.
 *
 * Input: dated legal source text (a statute section, revenue bulletin, or
 * scraped rate/apportionment table row) describing a state corporate tax rule
 * change.
 *
 * Output: a machine-readable `RulesetProposal` — the EXACT shape the state
 * rule engine executes — plus:
 *   - deterministic validation (sane rate range, known state code, weights
 *     summing to 1, provenance present) and
 *   - a diff against STATE_RULESET ("what would change if a CPA approved").
 *
 * LLM for extraction, deterministic math for the contract — same hybrid as
 * the Credit Miner. A proposal that fails validation is surfaced to the human
 * reviewer with the issues; it can never silently mutate the ruleset. The
 * approval half of the loop (CPA review → ruleset + snapshot updated together
 * → verifier gates) is documented in docs/STATE_RULE_REFRESH.md.
 */

import { z } from 'zod';
import { callJsonModel } from '../../eve/model-client.js';
import { logger } from '../../lib/logger.js';
import {
  diffProposalAgainstRuleset,
  validateProposal,
  type RulesetProposal,
} from '@taxpro/tax-engine-enterprise/us/proposals';

/** Mirrors `RulesetProposal` from the engine package (zod for the LLM contract). */
export const rulesetProposalSchema = z.object({
  stateCode: z.string(),
  taxYear: z.number().int(),
  filingType: z.enum(['cit', 'grossReceipts', 'none']),
  schedule: z.object({
    kind: z.enum(['flat', 'bracketed']),
    rate: z.number(),
  }),
  apportionmentWeights: z
    .object({
      payroll: z.number(),
      property: z.number(),
      sales: z.number(),
    })
    .optional(),
  source: z.object({
    name: z.string(),
    url: z.string(),
    publishedAt: z.string(),
  }),
  excerpt: z.string(),
  confidence: z.coerce.number(),
  reasoning: z.string(),
});

// ── Types ──

export interface RuleUpdateAgentInput {
  tenantId: string;
  tenantName?: string;
  /** The raw legal text to extract the rule from (statute, bulletin, table row). */
  sourceText: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  taxYear: number;
}

export interface RuleUpdateAgentResult {
  /** The machine-readable proposal (null when extraction or validation failed). */
  proposal: RulesetProposal | null;
  /** Deterministic sanity-check result. */
  validation: { valid: boolean; issues: string[] };
  /** What applying the proposal would change (null when no proposal). */
  diff: ReturnType<typeof diffProposalAgainstRuleset> | null;
  success: boolean;
  error?: string;
}

// ── System Prompt ──

const RULE_UPDATE_SYSTEM_PROMPT = `You are a state corporate income tax specialist at a national CPA firm. Your job is to turn dated legal source text into a machine-readable rule update — nothing more.

The engine stores, per jurisdiction, exactly these fields:
- stateCode: two-letter code (e.g. "NE", "CA"). Use DC for the District of Columbia.
- taxYear: the integer tax year the rule is effective for.
- filingType: "cit" when the jurisdiction levies a corporate income/excise/BPT tax; "grossReceipts" when it substitutes a gross-receipts or margin tax (OH, TX, WA, NV); "none" when it levies no such tax (SD, WY).
- schedule.kind: "flat" when one rate applies to the whole base; "bracketed" when the tax is tiered — in that case record ONLY the TOP marginal rate.
- schedule.rate: the top marginal rate as a FRACTION (7.5% = 0.075, never 7.5).
- apportionmentWeights: payroll/property/sales weights as fractions summing to 1. Single sales factor = {0, 0, 1}. Equal three-factor = {1/3, 1/3, 1/3}. Double-weighted sales = {0.25, 0.25, 0.5}. Omit when the source text does not state or imply a formula.
- source: { name, url, publishedAt } exactly as given to you — never invent a URL.
- excerpt: the verbatim source-text passage the rule came from (up to ~500 chars).
- confidence: 0.0–1.0 — be conservative; 0.9+ only when the rate/structure is explicit, lower when the text is ambiguous or conflicts with other provisions.
- reasoning: one or two sentences citing the provision and the effective date.

Rules:
1. Only extract what the source text actually says. Do NOT use your own knowledge of current law.
2. When the text conflicts with itself or is ambiguous, lower confidence and say so in reasoning.
3. If the text describes no rate change (e.g. an unrelated provision), still return the fields you can determine and set confidence below 0.5.
4. Output ONLY the JSON object.`;

// ── Main Execution ──

export async function runRuleUpdateAgent(input: RuleUpdateAgentInput): Promise<RuleUpdateAgentResult> {
  logger.info({ tenantId: input.tenantId, source: input.sourceName, taxYear: input.taxYear }, '[RuleUpdateAgent] Starting');

  try {
    const response = await callJsonModel({
      schema: rulesetProposalSchema,
      system: RULE_UPDATE_SYSTEM_PROMPT,
      user: [
        `Source: ${input.sourceName}`,
        `URL: ${input.sourceUrl}`,
        `Published: ${input.publishedAt}`,
        `Target tax year: ${input.taxYear}`,
        '',
        'Source text:',
        input.sourceText,
      ].join('\n'),
      promptVersion: 'rule-update-extract-v1',
      temperature: 0.0,
    });

    const rawProposal = response.parsed;
    const proposal: RulesetProposal = {
      stateCode: rawProposal.stateCode,
      taxYear: rawProposal.taxYear,
      filingType: rawProposal.filingType,
      schedule: rawProposal.schedule,
      apportionmentWeights: rawProposal.apportionmentWeights,
      source: {
        name: input.sourceName,
        url: input.sourceUrl,
        publishedAt: input.publishedAt,
      },
      excerpt: rawProposal.excerpt,
      confidence: rawProposal.confidence,
      reasoning: rawProposal.reasoning,
    };

    const validation = validateProposal(proposal);
    const diff = diffProposalAgainstRuleset(proposal);

    logger.info(
      { valid: validation.valid, breaking: diff.breaking, changes: diff.changes.length },
      '[RuleUpdateAgent] Complete',
    );

    if (!validation.valid) {
      return {
        proposal,
        validation,
        diff,
        success: false,
        error: `Extraction failed deterministic validation: ${validation.issues.join('; ')}`,
      };
    }

    return { proposal, validation, diff, success: true };
  } catch (err) {
    logger.error({ err }, '[RuleUpdateAgent] Failed');
    return {
      proposal: null,
      validation: { valid: false, issues: ['agent failed'] },
      diff: null,
      success: false,
      error: err instanceof Error ? err.message : 'Rule update agent failed',
    };
  }
}
