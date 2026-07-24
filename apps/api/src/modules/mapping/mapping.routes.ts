import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { accounts } from '../../db/schema/accounts.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { logger } from '../../lib/logger.js';
import { and, desc, eq } from 'drizzle-orm';

import { addMappingJob, mappingQueue } from './ai/queue.js';

export const mappingRoutes = new Hono();
mappingRoutes.use('*', authMiddleware);

// Get all mappings
mappingRoutes.get('/mappings', async (c) => {
  const user = c.get('user');
  const mappings = await db.select().from(taxMappings)
    .where(eq(taxMappings.tenantId, user.tenantId))
    .orderBy(taxMappings.updatedAt);
  return c.json(mappings);
});

// Get mappings for a specific account
mappingRoutes.get('/mappings/:accountId', async (c) => {
  const user = c.get('user');
  const mappings = await db.select().from(taxMappings)
    .where(and(
      eq(taxMappings.tenantId, user.tenantId),
      eq(taxMappings.accountId, c.req.param('accountId')),
    ))
    .orderBy(taxMappings.version);
  return c.json(mappings);
});

const updateMappingSchema = z.object({
  taxAccountType: z.string(),
  bookTreatment: z.enum(['permanent', 'temporary', 'no_diff']),
  timingCategory: z.string().optional(),
  overrideReason: z.string().optional(),
});

// Manually override an AI-suggested mapping
mappingRoutes.post('/mappings/:accountId/override', zValidator('json', updateMappingSchema), async (c) => {
  const user = c.get('user');
  const { taxAccountType, bookTreatment, timingCategory, overrideReason } = c.req.valid('json');

  const [currentMapping] = await db.select().from(taxMappings)
    .where(and(
      eq(taxMappings.tenantId, user.tenantId),
      eq(taxMappings.accountId, c.req.param('accountId')),
    ))
    .orderBy(desc(taxMappings.version))
    .limit(1);

  const newVersion = (currentMapping?.version ?? 0) + 1;

  if (currentMapping) {
    await db.update(taxMappings).set({ isActive: false })
      .where(eq(taxMappings.id, currentMapping.id));
  }

  const [mapping] = await db.insert(taxMappings).values({
    tenantId: user.tenantId,
    accountId: c.req.param('accountId'),
    taxAccountType,
    bookTreatment,
    timingCategory,
    suggestedByAi: false,
    overrideReason,
    version: newVersion,
    confidenceScore: '1.0',
  }).returning();

  return c.json(mapping, 201);
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
