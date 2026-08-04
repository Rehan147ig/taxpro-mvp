import { pgTable, uuid, varchar, date, timestamp, text, jsonb } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { entities } from './entities.js';
import { accountingPeriods } from './accounting-periods.js';
import { taxPeriods } from './tax-periods.js';
import { sourceDocuments } from './source-documents.js';

export const provisionRuns = pgTable('provision_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  period: date('period').notNull(),
  endPeriod: date('end_period'),
  entityId: uuid('entity_id'),
  status: varchar('status', { length: 40 }).notNull().default('uploaded'),
  mode: varchar('mode', { length: 20 }).notNull().default('direct'),
  inputDataHash: varchar('input_data_hash', { length: 128 }),
  mappingVersionHash: varchar('mapping_version_hash', { length: 128 }),
  // Exactly which rule versions (uk_rules keys) this run's calculation used.
  // Populated from the rule registry at run creation; never derived from AI.
  rulesUsed: jsonb('rules_used'),
  engineVersion: varchar('engine_version', { length: 40 }).notNull().default('tax-engine-0.1.0'),
  // ── Phase C workbench contract (migration 0014) ──
  sourceDocumentId: uuid('source_document_id').references(() => sourceDocuments.id, { onDelete: 'set null' }),
  accountingPeriodId: uuid('accounting_period_id').references(() => accountingPeriods.id, { onDelete: 'set null' }),
  taxPeriodId: uuid('tax_period_id').references(() => taxPeriods.id, { onDelete: 'set null' }),
  parentRunId: uuid('parent_run_id').references((): AnyPgColumn => provisionRuns.id, { onDelete: 'set null' }),
  mappingSnapshot: jsonb('mapping_snapshot'),
  assumptions: jsonb('assumptions'),
  warnings: jsonb('warnings'),
  correlationId: varchar('correlation_id', { length: 64 }),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  approvalStatus: varchar('approval_status', { length: 30 }).notNull().default('not_required'),
  resultId: uuid('result_id'),
  finalOutputUrl: text('final_output_url'),
  exceptionSummary: text('exception_summary'),
  // ── Canonical approval and lock timestamps ──
  submittedAt: timestamp('submitted_at'),
  submittedByUserId: uuid('submitted_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  lockedAt: timestamp('locked_at'),
  lockedByUserId: uuid('locked_by_user_id').references(() => users.id),
  rejectedAt: timestamp('rejected_at'),
  rejectedByUserId: uuid('rejected_by_user_id').references(() => users.id),
  rejectionReason: text('rejection_reason'),
  preparedByUserId: uuid('prepared_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  finalizedAt: timestamp('finalized_at'),
});
