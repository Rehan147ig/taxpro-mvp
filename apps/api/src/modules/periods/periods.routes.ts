import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { entityGroups } from '../../db/schema/entity-groups.js';
import { accountingPeriods } from '../../db/schema/accounting-periods.js';
import { taxPeriods } from '../../db/schema/tax-periods.js';
import { entities } from '../../db/schema/entities.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { validatePeriodDates } from './period-validation.js';

const TAX_PERIOD_STATUSES = ['draft', 'open', 'in_progress', 'needs_review', 'closed', 'locked'] as const;

export const periodRoutes = new Hono();
periodRoutes.use('*', authMiddleware);

// ── Entity groups ──

const createGroupSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  parentGroupId: z.string().uuid().optional(),
});

periodRoutes.get('/groups', async (c) => {
  const user = getUser(c);
  return withTenantContext(user.tenantId, async (tx) => {
    const groups = await tx.select().from(entityGroups)
      .where(eq(entityGroups.tenantId, user.tenantId))
      .orderBy(entityGroups.name);
    return c.json(groups);
  });
});

periodRoutes.post('/groups', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', createGroupSchema), async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      if (body.parentGroupId) {
        const [parent] = await tx.select({ id: entityGroups.id }).from(entityGroups)
          .where(and(eq(entityGroups.id, body.parentGroupId), eq(entityGroups.tenantId, user.tenantId))).limit(1);
        if (!parent) throw new BadRequestError('Parent group not found in this tenant');
      }
      const [group] = await tx.insert(entityGroups).values({
        tenantId: user.tenantId,
        name: body.name,
        description: body.description ?? null,
        parentGroupId: body.parentGroupId ?? null,
      }).returning();
      return c.json(group, 201);
    });
  });

periodRoutes.patch('/groups/:id', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ name: z.string().min(1).max(255).optional(), description: z.string().max(2000).nullable().optional() })),
  async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [group] = await tx.update(entityGroups).set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        updatedAt: new Date(),
      }).where(and(eq(entityGroups.id, c.req.param('id')), eq(entityGroups.tenantId, user.tenantId))).returning();
      if (!group) throw new NotFoundError('Entity group', c.req.param('id'));
      return c.json(group);
    });
  });

// Assign an entity to a group
periodRoutes.patch('/entities/:id/group', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ groupId: z.string().uuid() })), async (c) => {
    const user = getUser(c);
    const { groupId } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [group] = await tx.select({ id: entityGroups.id }).from(entityGroups)
        .where(and(eq(entityGroups.id, groupId), eq(entityGroups.tenantId, user.tenantId))).limit(1);
      if (!group) throw new BadRequestError('Group not found in this tenant');
      const [entity] = await tx.update(entities).set({ groupId, updatedAt: new Date() })
        .where(and(eq(entities.id, c.req.param('id')), eq(entities.tenantId, user.tenantId))).returning();
      if (!entity) throw new NotFoundError('Entity', c.req.param('id'));
      return c.json(entity);
    });
  });

// ── Accounting periods ──

const createAccountingPeriodSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().min(1).max(255),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodType: z.enum(['monthly', 'quarterly', 'annual', 'other']).default('annual'),
  status: z.enum(['open', 'closed', 'archived']).default('open'),
});

periodRoutes.get('/accounting', async (c) => {
  const user = getUser(c);
  const entityId = c.req.query('entityId');
  return withTenantContext(user.tenantId, async (tx) => {
    const rows = await tx.select().from(accountingPeriods)
      .where(and(eq(accountingPeriods.tenantId, user.tenantId), entityId ? eq(accountingPeriods.entityId, entityId) : undefined))
      .orderBy(accountingPeriods.startDate);
    return c.json(rows);
  });
});

periodRoutes.post('/accounting', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', createAccountingPeriodSchema), async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');
    validatePeriodDates(body.startDate, body.endDate);
    return withTenantContext(user.tenantId, async (tx) => {
      const [entity] = await tx.select({ id: entities.id }).from(entities)
        .where(and(eq(entities.id, body.entityId), eq(entities.tenantId, user.tenantId))).limit(1);
      if (!entity) throw new BadRequestError('Entity not found in this tenant');
      const [period] = await tx.insert(accountingPeriods).values({
        tenantId: user.tenantId,
        entityId: body.entityId,
        name: body.name,
        startDate: body.startDate,
        endDate: body.endDate,
        periodType: body.periodType,
        status: body.status,
      }).returning();
      return c.json(period, 201);
    });
  });

// ── Tax periods ──

const createTaxPeriodSchema = z.object({
  entityId: z.string().uuid(),
  accountingPeriodId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(TAX_PERIOD_STATUSES).default('draft'),
});

periodRoutes.get('/tax', async (c) => {
  const user = getUser(c);
  const entityId = c.req.query('entityId');
  return withTenantContext(user.tenantId, async (tx) => {
    const rows = await tx.select().from(taxPeriods)
      .where(and(eq(taxPeriods.tenantId, user.tenantId), entityId ? eq(taxPeriods.entityId, entityId) : undefined))
      .orderBy(taxPeriods.startDate);
    return c.json(rows);
  });
});

periodRoutes.post('/tax', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', createTaxPeriodSchema), async (c) => {
    const user = getUser(c);
    const body = c.req.valid('json');

    // Explicit validation; non-standard periods are flagged for review,
    // never silently computed as if they were 12 months.
    const validation = validatePeriodDates(body.startDate, body.endDate);

    return withTenantContext(user.tenantId, async (tx) => {
      const [entity] = await tx.select({ id: entities.id, name: entities.name }).from(entities)
        .where(and(eq(entities.id, body.entityId), eq(entities.tenantId, user.tenantId))).limit(1);
      if (!entity) throw new BadRequestError('Entity not found in this tenant');

      if (body.accountingPeriodId) {
        const [ap] = await tx.select({ id: accountingPeriods.id }).from(accountingPeriods)
          .where(and(eq(accountingPeriods.id, body.accountingPeriodId), eq(accountingPeriods.tenantId, user.tenantId))).limit(1);
        if (!ap) throw new BadRequestError('Accounting period not found in this tenant');
      }

      const status = validation.flags.length > 0 ? 'needs_review' : body.status;
      const [period] = await tx.insert(taxPeriods).values({
        tenantId: user.tenantId,
        entityId: body.entityId,
        accountingPeriodId: body.accountingPeriodId ?? null,
        startDate: body.startDate,
        endDate: body.endDate,
        durationMonths: validation.durationMonths,
        isStandardDuration: validation.isStandardDuration,
        status,
        createdByUserId: user.userId,
      }).returning();

      // Non-standard periods become review items (human must confirm).
      for (const flag of validation.flags) {
        await tx.insert(reviewItems).values({
          tenantId: user.tenantId,
          itemType: 'non_standard_period',
          severity: validation.durationMonths > 12 ? 'high' : 'medium',
          status: 'open',
          title: `Non-standard tax period for ${entity.name}`,
          description: `${body.startDate} to ${body.endDate}. ${flag}`,
          entityId: body.entityId,
        });
      }

      return c.json({ ...period, validation }, 201);
    });
  });

periodRoutes.patch('/tax/:id/status', requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ status: z.enum(TAX_PERIOD_STATUSES) })), async (c) => {
    const user = getUser(c);
    const { status } = c.req.valid('json');
    return withTenantContext(user.tenantId, async (tx) => {
      const [period] = await tx.update(taxPeriods).set({ status, updatedAt: new Date() })
        .where(and(eq(taxPeriods.id, c.req.param('id')), eq(taxPeriods.tenantId, user.tenantId))).returning();
      if (!period) throw new NotFoundError('Tax period', c.req.param('id'));
      return c.json(period);
    });
  });
