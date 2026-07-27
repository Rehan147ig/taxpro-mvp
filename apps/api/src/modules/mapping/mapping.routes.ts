import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser, requireRole, assertRunIsMutable } from '../../lib/middleware/rbac.js';
import { logger } from '../../lib/logger.js';
import { recordProvisionEvent, EVENT_TYPES } from '../provision/provision-events.js';
import { addMappingJob, mappingQueue } from './ai/queue.js';

export const mappingRoutes = new Hono();
mappingRoutes.use('*', authMiddleware);

// Get all mappings
mappingRoutes.get('/mappings', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const statusFilter = c.req.query('status');
    const conditions = [eq(taxMappings.tenantId, user.tenantId)];
    if (statusFilter && ['active', 'draft', 'rejected'].includes(statusFilter)) {
      conditions.push(eq(taxMappings.status, statusFilter));
    }
    const mappings = await tx.select().from(taxMappings)
      .where(and(...conditions))
      .orderBy(taxMappings.updatedAt);
    return c.json(mappings);
  });
});

// Get mappings for a specific account
mappingRoutes.get('/mappings/:accountId', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const mappings = await tx.select().from(taxMappings)
      .where(and(
        eq(taxMappings.tenantId, user.tenantId),
        eq(taxMappings.accountId, c.req.param('accountId')),
      ))
      .orderBy(taxMappings.version);
    return c.json(mappings);
  });
});

// Reject a draft mapping (soft-delete)
mappingRoutes.patch('/mappings/:accountId/reject',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({ reason: z.string().optional() })), async (c) => {
    const user = getUser(c);
    const { reason } = c.req.valid('json');

    return withTenantContext(user.tenantId, async (tx) => {
      const [current] = await tx.select().from(taxMappings)
        .where(and(
          eq(taxMappings.tenantId, user.tenantId),
          eq(taxMappings.accountId, c.req.param('accountId')),
          eq(taxMappings.isActive, true),
        ))
        .orderBy(desc(taxMappings.version))
        .limit(1);

      if (!current) return c.json({ error: 'No active mapping found' }, 404);
      if (current.status !== 'draft') return c.json({ error: 'Only draft mappings can be rejected' }, 400);

      const [updated] = await tx.update(taxMappings)
        .set({ status: 'rejected', isActive: false, overrideReason: reason || 'Rejected by user' })
        .where(eq(taxMappings.id, current.id))
        .returning();

      return c.json(updated);
    });
});

const updateMappingSchema = z.object({
  taxAccountType: z.string(),
  bookTreatment: z.enum(['permanent', 'temporary', 'no_diff']),
  timingCategory: z.string().optional(),
  overrideReason: z.string().optional(),
});

// Manually override an AI-suggested mapping
mappingRoutes.post('/mappings/:accountId/override',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', updateMappingSchema), async (c) => {
    const user = getUser(c);
    const { taxAccountType, bookTreatment, timingCategory, overrideReason } = c.req.valid('json');

    const body = await c.req.json().catch(() => ({}));

    return withTenantContext(user.tenantId, async (tx) => {
      if (body.provisionRunId) {
        await assertRunIsMutable(body.provisionRunId, user.tenantId, tx);
      }
      const [currentMapping] = await tx.select().from(taxMappings)
        .where(and(
          eq(taxMappings.tenantId, user.tenantId),
          eq(taxMappings.accountId, c.req.param('accountId')),
        ))
        .orderBy(desc(taxMappings.version))
        .limit(1);

      const newVersion = (currentMapping?.version ?? 0) + 1;

      if (currentMapping) {
        await tx.update(taxMappings).set({ isActive: false })
          .where(eq(taxMappings.id, currentMapping.id));
      }

      const [mapping] = await tx.insert(taxMappings).values({
        tenantId: user.tenantId,
        accountId: c.req.param('accountId'),
        taxAccountType,
        bookTreatment,
        timingCategory,
        suggestedByAi: false,
        overrideReason,
        version: newVersion,
        confidenceScore: '1.0',
        status: 'active',
        isActive: true,
      }).returning();

      if (body.provisionRunId) {
        await recordProvisionEvent({
          tenantId: user.tenantId,
          provisionRunId: body.provisionRunId,
          eventType: EVENT_TYPES.MAPPING_OVERRIDE,
          actorType: 'user',
          actorUserId: user.userId,
          reason: overrideReason || `Mapping override for account ${c.req.param('accountId')}`,
          metadata: { accountId: c.req.param('accountId'), taxAccountType, bookTreatment, timingCategory },
        }, tx);
      }

      return c.json(mapping, 201);
    });
});

// Run AI/fallback mapping on all unmapped accounts — async via BullMQ
mappingRoutes.post('/mappings/run-ai', async (c) => {
  const user = c.get('user');
  const jobId = await addMappingJob(user.tenantId);
  return c.json({ jobId, message: 'Mapping job enqueued' }, 202);
});

// Poll job status — used by the frontend to detect completion
mappingRoutes.get('/mappings/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await mappingQueue.getJob(jobId);

  if (!job) return c.json({ error: 'Job not found' }, 404);

  const state = await job.getState();
  const progress = await job.progress;

  return c.json({
    jobId,
    state,
    progress: typeof progress === 'number' ? {} : progress,
    result: job.returnvalue,
  });
});
