import { pgTable, uuid, varchar, timestamp, text, jsonb, decimal, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * Stores historical override feedback patterns.
 *
 * Every time a CPA overrides or approves an AI mapping, a pattern is recorded.
 * Future classifications can query similar account names to improve accuracy.
 */
export const classificationPatterns = pgTable('classification_patterns', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  accountName: varchar('account_name', { length: 255 }).notNull(),
  accountNumber: varchar('account_number', { length: 50 }),
  accountType: varchar('account_type', { length: 50 }),
  detailType: varchar('detail_type', { length: 100 }),
  mappedType: varchar('mapped_type', { length: 100 }).notNull(),
  bookTreatment: varchar('book_treatment', { length: 50 }).notNull(),
  timingCategory: varchar('timing_category', { length: 50 }),
  resolution: varchar('resolution', { length: 20 }).notNull().default('approved'), // approved | rejected | override
  source: varchar('source', { length: 20 }).notNull().default('override'), // override | ai | fallback
  originalConfidence: decimal('original_confidence', { precision: 3, scale: 2 }),
  overriddenFromType: varchar('overridden_from_type', { length: 100 }),
  overrideReason: text('override_reason'),
  accountNameTokens: jsonb('account_name_tokens'), // normalized tokens for fuzzy matching
  createdAt: timestamp('created_at').defaultNow(),
});

// Index for fast pattern lookup by account name similarity
// We query by normalized tokens at query time
