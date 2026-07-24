import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { classificationPatterns } from '../db/schema/classification-patterns.js';
import { taxMappings } from '../db/schema/tax-mappings.js';
import { accounts } from '../db/schema/accounts.js';
import { logger } from '../lib/logger.js';

/**
 * Pattern matching service for learning from CPA override history.
 *
 * When a human overrides an AI classification, we store the pattern.
 * Future classifications query similar patterns to adjust confidence.
 */

interface OverrideEvent {
  tenantId: string;
  accountId: string;
  resolution: 'approved' | 'rejected' | 'override';
  resolvedByUserId?: string;
  resolutionNote?: string;
}

/**
 * Record a classification pattern from a reviewer's decision.
 * Called when review items are resolved (approved/rejected/override).
 */
export async function recordClassificationPattern(event: OverrideEvent) {
  // Fetch the account + mapping details
  const [account] = await db.select().from(accounts)
    .where(and(eq(accounts.tenantId, event.tenantId), eq(accounts.id, event.accountId)))
    .limit(1);
  if (!account) return;

  const activeMapping = await db.select().from(taxMappings)
    .where(and(
      eq(taxMappings.tenantId, event.tenantId),
      eq(taxMappings.accountId, event.accountId),
      eq(taxMappings.isActive, true),
    ))
    .limit(1);

  const mapping = activeMapping[0];
  if (!mapping) return;

  const tokens = tokenize(account.name);

  await db.insert(classificationPatterns).values({
    tenantId: event.tenantId,
    accountName: account.name,
    accountNumber: account.accountNumber,
    accountType: account.type,
    detailType: account.detailType,
    mappedType: mapping.taxAccountType,
    bookTreatment: mapping.bookTreatment,
    timingCategory: mapping.timingCategory,
    resolution: event.resolution,
    source: mapping.suggestedByAi ? 'ai' : 'override',
    originalConfidence: mapping.confidenceScore,
    overrideReason: event.resolutionNote,
    accountNameTokens: tokens,
  });
}

/**
 * Find similar override patterns for a given account name.
 * Searches both this tenant and cross-tenant for broader pattern matching.
 * Returns patterns sorted by token overlap similarity.
 */
export async function findSimilarPatterns(
  tenantId: string,
  accountName: string,
  accountType?: string,
  limit = 5,
): Promise<Array<{ pattern: typeof classificationPatterns.$inferSelect; score: number }>> {
  const tokens = tokenize(accountName);
  if (tokens.length === 0) return [];

  // Use PostgreSQL jsonb @> containment: find rows where tokens are a subset
  // of the stored account_name_tokens, or vice-versa
  const results = await db.execute(sql`
    SELECT * FROM classification_patterns
    WHERE (
      account_name_tokens @> ${JSON.stringify(tokens)}::jsonb
      OR ${JSON.stringify(tokens)}::jsonb @> account_name_tokens
    )
    ORDER BY created_at DESC
    LIMIT ${limit * 3}
  `);

  const rows = results.rows as any[];
  if (rows.length === 0) return [];

  const scored = rows.map((p: any) => ({
    pattern: p as typeof classificationPatterns.$inferSelect,
    score: jaccardSimilarity(tokens, (p.account_name_tokens as string[]) ?? []),
  }));

  return scored
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Build a confidence boost based on historical patterns.
 * Returns how much to adjust confidence (0 = no change, 0.15 = +15%).
 */
export async function getConfidenceBoost(
  tenantId: string,
  accountName: string,
  suggestedType: string,
): Promise<{ boost: number; reason: string | null }> {
  const patterns = await findSimilarPatterns(tenantId, accountName);

  if (patterns.length === 0) {
    return { boost: 0, reason: null };
  }

  // Check if similar accounts were mapped the same way
  const sameType = patterns.filter((p) => p.pattern.mappedType === suggestedType);
  const diffType = patterns.filter((p) => p.pattern.mappedType !== suggestedType);

  if (sameType.length > diffType.length) {
    const topScore = Math.max(...sameType.map((s) => s.score));
    const boost = Math.min(topScore * 0.15, 0.12);
    return {
      boost,
      reason: `${sameType.length} similar account(s) confirmed this classification`,
    };
  }

  if (diffType.length > sameType.length) {
    return {
      boost: -0.1,
      reason: `${diffType.length} similar account(s) were classified differently`,
    };
  }

  return { boost: 0, reason: null };
}

/**
 * Tokenize an account name into normalized words for matching.
 */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[&,./()'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2) // skip short tokens like "&", "a", "an"
    .filter((t) => !['the', 'and', 'for', 'expense', 'income', 'revenue'].includes(t));
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
