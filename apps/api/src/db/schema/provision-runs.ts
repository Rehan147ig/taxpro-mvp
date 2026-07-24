import { pgTable, uuid, varchar, date, timestamp, text } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const provisionRuns = pgTable('provision_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
  period: date('period').notNull(),
  endPeriod: date('end_period'),
  entityId: uuid('entity_id'),
  status: varchar('status', { length: 40 }).notNull().default('uploaded'),
  mode: varchar('mode', { length: 20 }).notNull().default('direct'),
  inputDataHash: varchar('input_data_hash', { length: 128 }),
  mappingVersionHash: varchar('mapping_version_hash', { length: 128 }),
  engineVersion: varchar('engine_version', { length: 40 }).notNull().default('tax-engine-0.1.0'),
  approvalStatus: varchar('approval_status', { length: 30 }).notNull().default('not_required'),
  resultId: uuid('result_id'),
  finalOutputUrl: text('final_output_url'),
  exceptionSummary: text('exception_summary'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  finalizedAt: timestamp('finalized_at'),
});
