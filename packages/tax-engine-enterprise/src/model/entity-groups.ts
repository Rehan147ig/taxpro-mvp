// ── Entity Groups — multi-entity tax model ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { pgTable, uuid, text, numeric, timestamp, date, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import type { ProvisionSummary } from '@taxpro/tax-engine';

/**
 * A consolidated group of entities that share a tax presence (e.g. a UK group
 * with a parent and its subsidiaries, or a US consolidated group).
 *
 * Assumptions (guessed, UNVALIDATED):
 * - `domicile` is an ISO country-ish code ('UK', 'US') used only for routing
 *   rules; real residence is a legal determination this model does not make.
 * - A group has exactly one parent (enforced by role enum semantics, not by
 *   the database — a group with two parents would be invalid in practice).
 * - `currency` is the group-level reporting currency; member trial balances
 *   may still be in other currencies (not converted here — conversion is out
 *   of scope for this exploratory package).
 */
export const entityGroups = pgTable('entity_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  domicile: text('domicile').notNull().default('UK'),
  currency: text('currency').notNull().default('GBP'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type EntityGroup = typeof entityGroups.$inferSelect;
export type NewEntityGroup = typeof entityGroups.$inferInsert;

/**
 * Membership of an entity in a group.
 *
 * `entity_id`, `trial_balance_id` and `provision_id` are LOGICAL references:
 * the real entity, trial balance and provision tables are owned by the host
 * application (out of scope here). The link from `provision_id` to the
 * existing single-entity provision output is expressed in type form via
 * `EntityProvisionLink.provision` below, which reuses the existing
 * `ProvisionSummary` shape from @taxpro/tax-engine rather than duplicating it.
 *
 * Assumptions (guessed, UNVALIDATED):
 * - `ownership_percentage` is a value in (0, 100] for subsidiaries and 100 for
 *   the parent; decimals like 51.5 are allowed. No group-relief rules are
 *   derived from this number anywhere in this package.
 * - `role` may be 'parent' or 'subsidiary' only; a group with no parent row is
 *   invalid but not rejected by the schema.
 */
export const entityGroupMembers = pgTable(
  'entity_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => entityGroups.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id').notNull(),
    role: text('role', { enum: ['parent', 'subsidiary'] }).notNull(),
    ownershipPercentage: numeric('ownership_percentage', { precision: 6, scale: 3 }).notNull(),
    trialBalanceId: uuid('trial_balance_id'),
    provisionId: uuid('provision_id'),
    joinedOn: date('joined_on'),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.entityId] })],
);

export type EntityGroupMember = typeof entityGroupMembers.$inferSelect;
export type NewEntityGroupMember = typeof entityGroupMembers.$inferInsert;

/**
 * Type-level link between a group member and its standalone single-entity
 * provision. Reuses the existing single-entity provision output shape
 * (`ProvisionSummary` from @taxpro/tax-engine) instead of duplicating it.
 *
 * The standalone provision is the "own" provision computed for each entity as
 * if it were unconnected to the group; group-level adjustments (UK group
 * relief, US state apportionment) are computed on top of it by this package.
 *
 * UNVALIDATED: the presence of `provision` here assumes the host app computed
 * a provision for every subsidiary with a `provision_id`; missing provisions
 * must be handled by callers.
 */
export interface EntityProvisionLink {
  member: EntityGroupMember;
  standaloneProvision: ProvisionSummary;
}

/**
 * In-memory group model assembled from the two tables. Pure convenience —
 * performs no queries.
 */
export interface EntityGroupModel {
  group: EntityGroup;
  parent: EntityGroupMember | null;
  subsidiaries: EntityGroupMember[];
  provisionsByEntityId: ReadonlyMap<string, ProvisionSummary>;
}

export function assembleEntityGroupModel(
  group: EntityGroup,
  members: EntityGroupMember[],
  provisions: ProvisionSummary[],
): EntityGroupModel {
  const parent = members.find((m) => m.role === 'parent') ?? null;
  const subsidiaries = members.filter((m) => m.role === 'subsidiary');
  const provisionsByEntityId = new Map<string, ProvisionSummary>();
  for (const p of provisions) {
    provisionsByEntityId.set(p.entityId, p);
  }
  return { group, parent, subsidiaries, provisionsByEntityId };
}
