import { pgTable, uuid, varchar, date, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const ukRules = pgTable('uk_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ruleKey: varchar('rule_key', { length: 100 }).notNull(),
  jurisdiction: varchar('jurisdiction', { length: 30 }).notNull().default('UK_FRS102'),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  sourceUrl: varchar('source_url', { length: 500 }),
  sourceSnapshotHash: varchar('source_snapshot_hash', { length: 64 }),
  author: varchar('author', { length: 255 }),
  approvalState: varchar('approval_state', { length: 20 }).notNull().default('proposal'),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  version: integer('version').notNull().default(1),
  testFixtureRef: varchar('test_fixture_ref', { length: 255 }),
  changeRationale: text('change_rationale'),
  supersedesRuleId: uuid('supersedes_rule_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  unq: {
    name: 'uq_uk_rules_tenant_key_version',
    unique: true,
    columns: [table.tenantId, table.ruleKey, table.version],
  },
}));
