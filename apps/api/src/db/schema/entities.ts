import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  parentEntityId: uuid('parent_entity_id'),
  isConsolidated: boolean('is_consolidated').default(true),
  taxJurisdiction: varchar('tax_jurisdiction', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: { name: 'uq_entities_tenant_ext', unique: true, columns: [table.tenantId, table.externalId] },
}));
