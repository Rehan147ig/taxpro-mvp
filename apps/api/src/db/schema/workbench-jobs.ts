import { pgTable, uuid, varchar, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { provisionRuns } from './provision-runs.js';

export const workbenchJobs = pgTable('workbench_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  jobType: varchar('job_type', { length: 40 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  errorText: text('error_text'),
  correlationId: varchar('correlation_id', { length: 64 }),
  provisionRunId: uuid('provision_run_id').references(() => provisionRuns.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  unq: {
    name: 'uq_workbench_jobs_tenant_idempotency',
    columns: [table.tenantId, table.idempotencyKey],
  },
}));
