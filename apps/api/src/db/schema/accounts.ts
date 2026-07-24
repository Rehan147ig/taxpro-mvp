import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 100 }).notNull(),
  accountNumber: varchar('account_number', { length: 50 }),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  detailType: varchar('detail_type', { length: 100 }),
  isSummary: boolean('is_summary').default(false),
  parentId: uuid('parent_id'),
  isInactive: boolean('is_inactive').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: { name: 'uq_accounts_tenant_ext', unique: true, columns: [table.tenantId, table.externalId] },
}));
