// ── General Ledger Transactions — GL ingestion staging table ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { pgTable, uuid, text, numeric, timestamp, date, jsonb } from 'drizzle-orm/pg-core';

/**
 * Staging table for general-ledger transactions extracted from an ERP export.
 *
 * This is the "load" target of the ELT pipeline in `../elt/pipeline.js`.
 *
 * Assumptions (guessed, UNVALIDATED):
 * - `amount` is a SIGNED amount on a single-entry convention: positive =
 *   debit, negative = credit. Real GLs post balanced debits/credits; this
 *   staging model deliberately keeps one signed amount per row and assumes the
 *   adapter/normalizer produced the sign. If a real export uses separate
 *   debit/credit columns this table must change.
 * - `account_id` is a logical reference to the host app's chart-of-accounts
 *   table (owned elsewhere; out of scope here).
 * - `tenant_id` is a logical reference to the host app's tenant table.
 * - `raw_payload` keeps the entire original ERP row for re-derivation later
 *   (the ELT extracts, transforms and flags but never discards the source).
 * - `tax_tag_overrides` is an array of strings that override or annotate
 *   heuristic flags (e.g. a human marked an entertainment expense as
 *   business-promotional). Semantics of tag values are UNVALIDATED.
 */
export const generalLedgerTransactions = pgTable('general_ledger_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  accountId: uuid('account_id').notNull(),
  transactionDate: date('transaction_date').notNull(),
  sourceErp: text('source_erp').notNull(),
  rawPayload: jsonb('raw_payload'),
  amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('USD'),
  narration: text('narration'),
  taxTagOverrides: jsonb('tax_tag_overrides').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type GeneralLedgerTransaction = typeof generalLedgerTransactions.$inferSelect;
export type NewGeneralLedgerTransaction = typeof generalLedgerTransactions.$inferInsert;
