import { pgTable, uuid, varchar, timestamp, text, jsonb, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { provisionRuns } from './provision-runs.js';

export const reviewItems = pgTable('review_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provisionRunId: uuid('provision_run_id').references(() => provisionRuns.id, { onDelete: 'cascade' }),
  itemType: varchar('item_type', { length: 60 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull().default('medium'),
  status: varchar('status', { length: 30 }).notNull().default('open'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  entityId: uuid('entity_id'),
  accountId: uuid('account_id'),
  sourceRef: varchar('source_ref', { length: 120 }),
  confidenceScore: integer('confidence_score'),
  metadata: jsonb('metadata'),
  resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});
