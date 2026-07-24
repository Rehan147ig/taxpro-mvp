import { pgTable, uuid, varchar, decimal, date, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.21'),
  stateTaxRate: decimal('state_tax_rate', { precision: 5, scale: 4 }).default('0'),
  fiscalYearEnd: date('fiscal_year_end').notNull().default('2024-12-31'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
