import { z } from 'zod';
import crypto from 'crypto';
import { callJsonModel } from '../../apps/api/src/eve/model-client.js';
import { Jurisdiction } from '../../packages/tax-engine/src/types.js';

const MAPPED_ITEM_SCHEMA = z.object({
  items: z.array(z.object({
    accountNumber: z.string(),
    taxAccountType: z.string(),
    bookTreatment: z.enum(['permanent', 'temporary', 'no_diff']),
    timingCategory: z.string().optional(),
    confidenceScore: z.number().min(0).max(1),
    rationale: z.string(),
  })),
});

export type MappedItem = z.infer<typeof MAPPED_ITEM_SCHEMA>['items'][number];

export interface MappingInput {
  accountNumber: string;
  accountName: string;
  accountType: string;
  debit: string;
  credit: string;
  balance: string;
}

const classificationCache = new Map<string, MappedItem[]>();

function cacheKey(items: MappingInput[], jurisdiction: Jurisdiction): string {
  const content = items.map(i => `${i.accountNumber}:${i.accountName}`).join('|');
  return crypto.createHash('md5').update(`${content}:${jurisdiction}`).digest('hex');
}

export async function classifyAccounts(
  parsedItems: MappingInput[],
  jurisdiction: Jurisdiction,
): Promise<MappedItem[]> {
  const key = cacheKey(parsedItems, jurisdiction);
  const cached = classificationCache.get(key);
  if (cached) return cached;

  const taxTypeDescriptions = jurisdiction === Jurisdiction.UK_FRS102_S29
    ? `UK FRS 102 Section 29 categories:
  - TEMP_TIMING_DIFFERENCE — deductible/taxable timing differences
  - TEMP_UNRELIEVED_LOSS — trading losses carried forward
  - TEMP_FIXED_ASSET_ALLOWANCE — capital allowances vs book depreciation
  - PERM_OTHER — permanent differences not otherwise classified
  - NODIFF_OTHER — no tax difference`
    : `US ASC 740 categories:
  - PERM_* — permanent differences (meals, penalties, dividends, life insurance, tax-exempt interest, non-deductible goodwill, other)
  - TEMP_* — temporary differences (depreciation, amortization, bonus depreciation, Section 179, R&D credit, bad debt, inventory, warranty, deferred revenue, accrued liabilities, pension, NOL, tax credit carryforward, other)
  - NODIFF_* — no book-tax difference (cash, AR, AP, revenue, salaries, rent, utilities, other)`;

  const system = `You are a tax account classification agent. Classify each account into the appropriate tax category for the given jurisdiction.

${taxTypeDescriptions}

Rules:
- Determine bookTreatment: 'permanent' (never reverses), 'temporary' (reverses over time), 'no_diff' (same for book and tax)
- Assign timingCategory only for temporary differences: 'deductible_temporary' (DTA) or 'taxable_temporary' (DTL)
- Confidence score 0-1 based on certainty
- Provide a brief rationale`;

  const result = await callJsonModel({
    system,
    user: `Jurisdiction: ${jurisdiction}\n\nClassify these accounts:\n${JSON.stringify(parsedItems, null, 2)}`,
    temperature: 0.0,
    maxTokens: 4096,
    promptVersion: 'mapping-v1',
    schema: MAPPED_ITEM_SCHEMA,
  });

  const items = result.parsed.items;
  classificationCache.set(key, items);
  return items;
}
