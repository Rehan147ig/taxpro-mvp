import { z } from 'zod';
import { callJsonModel } from '../../eve/model-client.js';

const EXPLANATION_SCHEMA = z.object({
  explanations: z.array(z.object({
    section: z.string(),
    summary: z.string(),
    detail: z.string(),
    citations: z.array(z.object({
      rule: z.string(),
      reference: z.string(),
    })),
  })),
});

export interface Explanation {
  section: string;
  summary: string;
  detail: string;
  citations: { rule: string; reference: string }[];
}

export interface ExplanationInput {
  bookIncome: string;
  currentTax: Record<string, unknown>;
  deferredTax: Record<string, unknown>;
  etr: Record<string, unknown>;
  jurisdiction: string;
  jurisdictionRules: string;
}

export async function generateExplanation(
  input: ExplanationInput,
): Promise<Explanation[]> {
  const system = `You are a tax provision explanation generator. Generate audit-quality explanations for each section of the provision.

For each section, provide:
- A one-line summary
- A detailed technical explanation
- Citations to the specific tax rule or standard

Reference the provided jurisdiction rules text for accurate rule citations.`;

  const result = await callJsonModel({
    system,
    user: `Generate explanations for this ${input.jurisdiction} tax provision:

Engine Output:
${JSON.stringify({
  bookIncome: input.bookIncome,
  currentTax: input.currentTax,
  deferredTax: input.deferredTax,
  etr: input.etr,
}, null, 2)}

Jurisdiction Rules:
${input.jurisdictionRules}`,
    temperature: 0.1,
    maxTokens: 8192,
    promptVersion: 'explanation-v1',
    schema: EXPLANATION_SCHEMA,
  });

  return result.parsed.explanations;
}
