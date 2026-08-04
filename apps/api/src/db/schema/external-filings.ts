import { pgTable, uuid, varchar, date, timestamp } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { provisionRuns } from './provision-runs.js';
import { sourceDocuments } from './source-documents.js';

/**
 * External filing ledger (migration 0016, Phase D).
 *
 * Append-only: every row records an EXTERNAL filing event — a CT600 /
 * iXBRL submission that happened OUTSIDE TaxPro (agent software, HMRC
 * gateway, paper), entered manually by an authorised user after the event
 * occurred. TaxPro never submits to HMRC itself, so nothing here is a
 * submission claim; it is a bookkeeping record of what the accountant did
 * with the exported package. Corrections are new rows via supersedesFilingId.
 */
export const externalFilings = pgTable('external_filings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull().references(() => provisionRuns.id),
  filingProvider: varchar('filing_provider', { length: 80 }).notNull(),
  filingReference: varchar('filing_reference', { length: 120 }).notNull(),
  submittedDate: date('submitted_date').notNull(),
  recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
  confirmationDocumentId: uuid('confirmation_document_id').references(() => sourceDocuments.id, { onDelete: 'set null' }),
  confirmationDocumentHash: varchar('confirmation_document_hash', { length: 64 }),
  manifestChecksum: varchar('manifest_checksum', { length: 64 }).notNull(),
  supersedesFilingId: uuid('supersedes_filing_id').references((): AnyPgColumn => externalFilings.id),
  createdAt: timestamp('created_at').defaultNow(),
});
