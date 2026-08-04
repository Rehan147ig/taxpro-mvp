import { pgTable, uuid, varchar, date, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { entities } from './entities.js';

export const accountingPeriods = pgTable('accounting_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  periodType: varchar('period_type', { length: 20 }).notNull().default('annual'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: {
    name: 'uq_accounting_periods_tenant_entity_dates',
    unique: true,
    columns: [table.tenantId, table.entityId, table.startDate, table.endDate],
  },
}));
