import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const connections = pgTable('connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 100 }).notNull(),
  accountId: varchar('account_id', { length: 100 }).notNull(),
  consumerKey: text('consumer_key').notNull(),
  consumerSecret: text('consumer_secret').notNull(),
  tokenId: text('token_id').notNull(),
  tokenSecret: text('token_secret').notNull(),
  realm: varchar('realm', { length: 255 }).notNull(),
  baseUrl: varchar('base_url', { length: 255 }).notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  syncStatus: varchar('sync_status', { length: 20 }).default('idle'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
