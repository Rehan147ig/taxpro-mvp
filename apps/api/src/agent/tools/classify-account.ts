import { db } from '../../config/db.js';
import { eq, and } from 'drizzle-orm';
import { accounts } from '../../db/schema/accounts.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { classifyAccountsAI, fallbackClassify, type AIMappingInput } from '../../modules/mapping/ai/mapper.js';
import { logger } from '../../lib/logger.js';

const parameters = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', description: 'The tenant/company ID whose accounts to classify' },
    specificAccountIds: {
      type: 'array', items: { type: 'string' },
      description: 'Optional: only classify these specific account IDs',
    },
  },
  required: ['tenantId'],
  additionalProperties: false,
};

export const classifyAccount = {
  spec: {
    description: 'Classify GL accounts into ASC 740 tax categories (Permanent, Temporary, or No Difference). Reuses DB mappings when available, only runs AI for unmapped accounts.',
    parameters,
  },
  execute: async (args: Record<string, any>) => {
    const { tenantId, specificAccountIds } = args;

    const allAccounts = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
    if (allAccounts.length === 0) {
      return { mappings: [], source: 'none', message: 'No accounts found for this tenant.' };
    }

    const existingMappings = await db.select().from(taxMappings)
      .where(and(eq(taxMappings.tenantId, tenantId), eq(taxMappings.isActive, true)));

    const formatMapping = (m: typeof taxMappings.$inferSelect) => ({
      accountId: m.accountId,
      taxAccountType: m.taxAccountType,
      bookTreatment: m.bookTreatment,
      timingCategory: m.timingCategory,
      confidenceScore: Number(m.confidenceScore ?? 0),
      explanation: m.aiExplanation ?? m.overrideReason ?? '',
    });

    if (specificAccountIds && specificAccountIds.length > 0) {
      const filtered = existingMappings.filter(m => specificAccountIds.includes(m.accountId));
      return { mappings: filtered.map(formatMapping), source: 'existing', message: `Returned ${filtered.length} existing mappings.` };
    }

    const mappedAccountIds = new Set(existingMappings.map(m => m.accountId));
    const unmappedAccounts = allAccounts.filter(a => !mappedAccountIds.has(a.id));

    if (unmappedAccounts.length === 0) {
      return { mappings: existingMappings.map(formatMapping), source: 'existing', message: `All ${allAccounts.length} accounts already mapped.` };
    }

    const input: AIMappingInput[] = unmappedAccounts.map(a => ({
      id: a.id, accountNumber: a.accountNumber ?? '', name: a.name, type: a.type, detailType: a.detailType ?? undefined,
    }));

    let newResults: any[];
    let source: string;
    try {
      newResults = await classifyAccountsAI(input);
      source = 'ai';
    } catch {
      newResults = fallbackClassify(input);
      source = 'fallback';
    }

    const combined = [...existingMappings.map(formatMapping), ...newResults];
    return { mappings: combined, source, newlyClassified: newResults.length, totalAccounts: allAccounts.length, message: `Reused ${existingMappings.length} + classified ${newResults.length} new via ${source}.` };
  },
};
