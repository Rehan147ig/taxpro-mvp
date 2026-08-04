import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { reviewItemEvents } from '../../db/schema/review-item-events.js';
import { sourceDocuments } from '../../db/schema/source-documents.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { reviewTransitionError } from './review-lifecycle.js';

export const reviewLifecycleRoutes = new Hono();
reviewLifecycleRoutes.use('*', authMiddleware);

export const REVIEW_ITEM_EVENT_TYPES = {
  STATUS_CHANGED: 'status_changed',
  OWNER_ASSIGNED: 'owner_assigned',
  EVIDENCE_REQUESTED: 'evidence_requested',
  EVIDENCE_ATTACHED: 'evidence_attached',
  WAIVED: 'waived',
  REOPENED: 'reopened',
} as const;

const VALID_STATUSES = ['open', 'in_progress', 'waiting_for_evidence', 'resolved', 'rejected', 'waived'] as const;

async function loadOwnItem(tx: any, tenantId: string, itemId: string) {
  const [item] = await tx.select().from(reviewItems)
    .where(and(eq(reviewItems.id, itemId), eq(reviewItems.tenantId, tenantId)))
    .limit(1);
  if (!item) throw new NotFoundError('Review item', itemId);
  return item;
}

async function assertTransition(item: any, from: string[], to: string, action: string) {
  if (!from.includes(item.status)) {
    throw new BadRequestError(`Cannot ${action} a review item in status '${item.status}' (allowed: ${from.join(', ')})`);
  }
  const err = reviewTransitionError(item.status, to);
  if (err) throw new BadRequestError(err);
}

async function recordEvent(tx: any, tenantId: string, itemId: string, userId: string, eventType: string, reason: string, beforeState: unknown, afterState: unknown, metadata?: Record<string, unknown>) {
  await tx.insert(reviewItemEvents).values({
    tenantId,
    reviewItemId: itemId,
    eventType,
    actorUserId: userId,
    reason,
    beforeState: beforeState as any,
    afterState: afterState as any,
    metadata: metadata as any,
  });
}

/**
 * Review lifecycle endpoints (Phase B).
 *
 * Status machine: open → in_progress → waiting_for_evidence → in_progress,
 * then resolved | rejected | waived. A waiver is a human-only decision:
 * it requires an authenticated partner/admin and a mandatory reason, and it
 * is recorded in the append-only review_item_events trail. An item can never
 * return from a final status (resolved/rejected/waived) except via an
 * explicit human reopen.
 */

// ── List review items across runs (filtered) ──
reviewLifecycleRoutes.get('/', async (c) => {
  const user = getUser(c);
  const status = c.req.query('status');
  const runId = c.req.query('runId');
  const conditions = [eq(reviewItems.tenantId, user.tenantId)];
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(reviewItems.status, status));
  }
  if (runId) conditions.push(eq(reviewItems.provisionRunId, runId));
  return withTenantContext(user.tenantId, async (tx) => {
    const rows = await tx.select().from(reviewItems)
      .where(and(...conditions))
      .orderBy(desc(reviewItems.createdAt));
    return c.json(rows);
  });
});

// ── Get an item with its decision history ──
reviewLifecycleRoutes.get('/:itemId', async (c) => {
  const user = getUser(c);
  const { itemId } = c.req.param();
  return withTenantContext(user.tenantId, async (tx) => {
    const item = await loadOwnItem(tx, user.tenantId, itemId);
    const events = await tx.select().from(reviewItemEvents)
      .where(and(
        eq(reviewItemEvents.reviewItemId, itemId),
        eq(reviewItemEvents.tenantId, user.tenantId),
      ))
      .orderBy(desc(reviewItemEvents.createdAt));
    return c.json({ item, events });
  });
});

// ── Assign owner / due date / update fields ──
reviewLifecycleRoutes.patch('/:itemId', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({
    ownerUserId: z.string().uuid().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    evidenceRequested: z.string().max(2000).optional(),
  })), async (c) => {
    const user = getUser(c);
    const { itemId } = c.req.param();
    const body = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      const item = await loadOwnItem(tx, user.tenantId, itemId);
      const before = { status: item.status, ownerUserId: item.ownerUserId, dueDate: item.dueDate };

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      const events: { type: string; reason: string; metadata: Record<string, unknown> }[] = [];
      if (body.ownerUserId !== undefined) {
        updates.ownerUserId = body.ownerUserId;
        events.push({ type: REVIEW_ITEM_EVENT_TYPES.OWNER_ASSIGNED, reason: `Owner assigned to ${body.ownerUserId}`, metadata: { ownerUserId: body.ownerUserId } });
      }
      if (body.dueDate !== undefined) {
        updates.dueDate = body.dueDate;
        events.push({ type: REVIEW_ITEM_EVENT_TYPES.STATUS_CHANGED, reason: `Due date set to ${body.dueDate}`, metadata: { dueDate: body.dueDate } });
      }
      if (body.evidenceRequested !== undefined) {
        updates.evidenceRequested = body.evidenceRequested;
        events.push({ type: REVIEW_ITEM_EVENT_TYPES.EVIDENCE_REQUESTED, reason: 'Evidence requested', metadata: { evidenceRequested: body.evidenceRequested } });
      }

      const [updated] = await tx.update(reviewItems).set(updates).where(eq(reviewItems.id, itemId)).returning();
      for (const ev of events) {
        await recordEvent(tx, user.tenantId, itemId, user.userId, ev.type, ev.reason, before, { status: updated.status }, ev.metadata);
      }
      return c.json(updated);
    });
  });

// ── Start working an item (open → in_progress) ──
reviewLifecycleRoutes.post('/:itemId/start', requireRole('preparer', 'reviewer', 'partner', 'admin'), async (c) => {
  const user = getUser(c);
  const { itemId } = c.req.param();
  return withTenantContext(user.tenantId, async (tx) => {
    const item = await loadOwnItem(tx, user.tenantId, itemId);
    await assertTransition(item, ['open', 'waiting_for_evidence'], 'in_progress', 'start');
    const before = { status: item.status };
    const [updated] = await tx.update(reviewItems).set({
      status: 'in_progress',
      ownerUserId: item.ownerUserId ?? user.userId,
      updatedAt: new Date(),
    }).where(eq(reviewItems.id, itemId)).returning();
    await recordEvent(tx, user.tenantId, itemId, user.userId, REVIEW_ITEM_EVENT_TYPES.STATUS_CHANGED, 'Work started', before, { status: 'in_progress' });
    return c.json(updated);
  });
});

// ── Request evidence (in_progress → waiting_for_evidence) ──
reviewLifecycleRoutes.post('/:itemId/request-evidence', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ evidenceRequested: z.string().min(1).max(2000) })), async (c) => {
    const user = getUser(c);
    const { itemId } = c.req.param();
    const { evidenceRequested } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const item = await loadOwnItem(tx, user.tenantId, itemId);
      await assertTransition(item, ['in_progress', 'open'], 'waiting_for_evidence', 'request evidence for');
      const before = { status: item.status };
      const [updated] = await tx.update(reviewItems).set({
        status: 'waiting_for_evidence',
        evidenceRequested,
        dueDate: item.dueDate ?? null,
        updatedAt: new Date(),
      }).where(eq(reviewItems.id, itemId)).returning();
      await recordEvent(tx, user.tenantId, itemId, user.userId, REVIEW_ITEM_EVENT_TYPES.EVIDENCE_REQUESTED, evidenceRequested, before, { status: 'waiting_for_evidence' });
      return c.json(updated);
    });
  });

// ── Attach evidence document (waiting_for_evidence → in_progress) ──
reviewLifecycleRoutes.post('/:itemId/attach-evidence', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ documentId: z.string().uuid() })), async (c) => {
    const user = getUser(c);
    const { itemId } = c.req.param();
    const { documentId } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const item = await loadOwnItem(tx, user.tenantId, itemId);
      await assertTransition(item, ['waiting_for_evidence', 'in_progress'], 'in_progress', 'attach evidence to');

      const [doc] = await tx.select({ id: sourceDocuments.id }).from(sourceDocuments)
        .where(and(eq(sourceDocuments.id, documentId), eq(sourceDocuments.tenantId, user.tenantId)))
        .limit(1);
      if (!doc) throw new NotFoundError('Source document', documentId);

      const before = { status: item.status, documentId: item.documentId };
      const [updated] = await tx.update(reviewItems).set({
        status: 'in_progress',
        documentId,
        updatedAt: new Date(),
      }).where(eq(reviewItems.id, itemId)).returning();
      await recordEvent(tx, user.tenantId, itemId, user.userId, REVIEW_ITEM_EVENT_TYPES.EVIDENCE_ATTACHED, 'Evidence attached', before, { status: 'in_progress', documentId });
      return c.json(updated);
    });
  });

// ── Waive an item: human-only, mandatory reason, append-only audit ──
reviewLifecycleRoutes.post('/:itemId/waive', requireRole('partner', 'admin'),
  zValidator('json', z.object({
    reason: z.string().min(1, 'A waiver requires a reason').max(2000),
  })), async (c) => {
    const user = getUser(c);
    const { itemId } = c.req.param();
    const { reason } = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      const item = await loadOwnItem(tx, user.tenantId, itemId);
      await assertTransition(item, ['open', 'in_progress', 'waiting_for_evidence'], 'waived', 'waive');

      const before = { status: item.status };
      const [updated] = await tx.update(reviewItems).set({
        status: 'waived',
        resolvedByUserId: user.userId,
        resolutionNote: reason,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(reviewItems.id, itemId)).returning();

      await recordEvent(tx, user.tenantId, itemId, user.userId, REVIEW_ITEM_EVENT_TYPES.WAIVED, reason, before, { status: 'waived' }, { waivedByRole: user.role });
      return c.json({ item: updated, note: 'Waiver recorded. A waived item is excluded from finalize-blockers but stays on the audit trail.' });
    });
  });

// ── Reopen a final-status item (human, append-only) ──
reviewLifecycleRoutes.post('/:itemId/reopen', requireRole('reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ reason: z.string().min(1).max(2000) })), async (c) => {
    const user = getUser(c);
    const { itemId } = c.req.param();
    const { reason } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const item = await loadOwnItem(tx, user.tenantId, itemId);
      if (!['resolved', 'rejected', 'waived'].includes(item.status)) {
        throw new BadRequestError(`Only final-status items can be reopened (current: ${item.status})`);
      }
      const before = { status: item.status };
      const [updated] = await tx.update(reviewItems).set({
        status: 'open',
        resolutionNote: null,
        resolvedAt: null,
        resolvedByUserId: null,
        updatedAt: new Date(),
      }).where(eq(reviewItems.id, itemId)).returning();
      await recordEvent(tx, user.tenantId, itemId, user.userId, REVIEW_ITEM_EVENT_TYPES.REOPENED, reason, before, { status: 'open' });
      return c.json(updated);
    });
  });
