import { pgTable, uuid, varchar, decimal, date, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { provisionRuns } from './provision-runs.js';

export const provisionResults = pgTable('provision_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  provisionRunId: uuid('provision_run_id').references(() => provisionRuns.id),
  period: date('period').notNull(),
  status: varchar('status', { length: 20 }).default('draft'),
  currentTaxExpense: decimal('current_tax_expense', { precision: 18, scale: 2 }).default('0'),
  deferredTaxExpense: decimal('deferred_tax_expense', { precision: 18, scale: 2 }).default('0'),
  totalTaxExpense: decimal('total_tax_expense', { precision: 18, scale: 2 }).default('0'),
  bookIncome: decimal('book_income', { precision: 18, scale: 2 }).default('0'),
  effectiveTaxRate: decimal('effective_tax_rate', { precision: 5, scale: 4 }).default('0'),
  statutoryRate: decimal('statutory_rate', { precision: 5, scale: 4 }).default('0'),
  taxPayable: decimal('tax_payable', { precision: 18, scale: 2 }).default('0'),
  valuationAllowance: decimal('valuation_allowance', { precision: 18, scale: 2 }).default('0'),
  createdAt: timestamp('created_at').defaultNow(),
});
