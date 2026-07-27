import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { provisionRuns } from './provision-runs.js';

export const provisionEvents = pgTable('provision_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  provisionRunId: uuid('provision_run_id').notNull().references(() => provisionRuns.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 60 }).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(), // user | agent | system
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorAgentId: uuid('actor_agent_id'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  reason: text('reason'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});