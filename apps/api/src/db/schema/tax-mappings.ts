import { pgTable, uuid, varchar, decimal, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { accounts } from './accounts.js';

export const taxMappings = pgTable('tax_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  taxAccountType: varchar('tax_account_type', { length: 100 }).notNull(),
  taxSubType: varchar('tax_sub_type', { length: 100 }),
  bookTreatment: varchar('book_treatment', { length: 50 }).notNull(),
  timingCategory: varchar('timing_category', { length: 50 }),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  suggestedByAi: boolean('suggested_by_ai').default(true),
  overrideReason: text('override_reason'),
  aiExplanation: text('ai_explanation'),
  isActive: boolean('is_active').default(true),
  version: integer('version').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: {
    name: 'uq_tax_mappings_account_version',
    unique: true,
    columns: [table.tenantId, table.accountId, table.version],
  },
}));
