import { pgTable, uuid, varchar, text, numeric, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { entities } from './entities.js';
import { accounts } from './accounts.js';
import { taxMappings } from './tax-mappings.js';
import { users } from './users.js';

export const mappingProposals = pgTable('mapping_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  sourceAccountExternalId: varchar('source_account_external_id', { length: 100 }).notNull(),
  sourceAccountName: varchar('source_account_name', { length: 255 }),
  targetTaxClassification: varchar('target_tax_classification', { length: 100 }).notNull(),
  bookTreatment: varchar('book_treatment', { length: 50 }).notNull(),
  timingCategory: varchar('timing_category', { length: 50 }),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }),
  proposalSource: varchar('proposal_source', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  reviewerUserId: uuid('reviewer_user_id').references(() => users.id),
  reviewerDecision: varchar('reviewer_decision', { length: 30 }),
  decisionReason: text('decision_reason'),
  decidedAt: timestamp('decided_at'),
  version: integer('version').notNull().default(1),
  carriesForward: boolean('carries_forward').notNull().default(false),
  priorMappingId: uuid('prior_mapping_id').references(() => taxMappings.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
