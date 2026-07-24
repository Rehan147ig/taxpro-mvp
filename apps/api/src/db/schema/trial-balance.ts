import { pgTable, uuid, varchar, decimal, integer, date, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { entities } from './entities.js';
import { accounts } from './accounts.js';

export const trialBalance = pgTable('trial_balance', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  entityId: uuid('entity_id').notNull().references(() => entities.id),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  period: date('period').notNull(),
  periodEnd: date('period_end').notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  fiscalPeriod: integer('fiscal_period').notNull(),
  debit: decimal('debit', { precision: 18, scale: 2 }).default('0'),
  credit: decimal('credit', { precision: 18, scale: 2 }).default('0'),
  balance: decimal('balance', { precision: 18, scale: 2 }).default('0'),
  source: varchar('source', { length: 20 }).default('netsuite'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  unq: {
    name: 'uq_tb_entity_account_period',
    unique: true,
    columns: [table.tenantId, table.entityId, table.accountId, table.period, table.source],
  },
}));
