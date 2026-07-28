import { z } from 'zod';
import { callJsonModel } from '../../apps/api/src/eve/model-client.js';

const PARSED_ITEM_SCHEMA = z.object({
  items: z.array(z.object({
    accountNumber: z.string(),
    accountName: z.string(),
    accountType: z.enum(['Income', 'Expense', 'Asset', 'Liability', 'Equity']),
    debit: z.string(),
    credit: z.string(),
    balance: z.string(),
    period: z.string(),
    entityId: z.string(),
  })),
  totalRows: z.number(),
  source: z.enum(['csv', 'pdf']),
});

export type ParsedItem = z.infer<typeof PARSED_ITEM_SCHEMA>['items'][number];

export interface ParseResult {
  items: ParsedItem[];
  totalRows: number;
  source: 'csv' | 'pdf';
}

export async function parseTrialBalance(
  rawContent: string,
  source: 'csv' | 'pdf',
): Promise<ParseResult> {
  const system = `You are a trial balance parser. Parse the provided ${source.toUpperCase()} content into structured items.
Extract: account number, account name, type (Income/Expense/Asset/Liability/Equity), debit amount, credit amount, balance, period, and entity ID.
Return all monetary values as strings preserving exact decimals.
For CSV, the first row is a header — skip it. For PDF, extract each row verbatim.`;

  const result = await callJsonModel({
    system,
    user: `Parse this trial balance ${source}:\n\n${rawContent}`,
    temperature: 0.0,
    maxTokens: 8192,
    promptVersion: 'parser-v1',
    schema: PARSED_ITEM_SCHEMA,
  });

  const parsed = result.parsed;
  return {
    items: parsed.items,
    totalRows: parsed.totalRows,
    source: parsed.source,
  };
}
