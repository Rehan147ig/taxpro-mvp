import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { reviewItems } from './review-items.js';
import { users } from './users.js';

export const reviewItemEvents = pgTable('review_item_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  reviewItemId: uuid('review_item_id').notNull().references(() => reviewItems.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 60 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  reason: text('reason'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});
