import { pgTable, uuid, varchar, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { provisionRuns } from './provision-runs.js';

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  provisionRunId: uuid('provision_run_id').references(() => provisionRuns.id, { onDelete: 'set null' }),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull().default('1'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  metadata: jsonb('metadata'),
});
