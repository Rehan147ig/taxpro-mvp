import { pgTable, uuid, varchar, date, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { entities } from './entities.js';
import { accountingPeriods } from './accounting-periods.js';
import { users } from './users.js';

export const taxPeriods = pgTable('tax_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  accountingPeriodId: uuid('accounting_period_id').references(() => accountingPeriods.id, { onDelete: 'set null' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  durationMonths: integer('duration_months').notNull(),
  isStandardDuration: boolean('is_standard_duration').notNull().default(true),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: {
    name: 'uq_tax_periods_tenant_entity_dates',
    unique: true,
    columns: [table.tenantId, table.entityId, table.startDate, table.endDate],
  },
}));
