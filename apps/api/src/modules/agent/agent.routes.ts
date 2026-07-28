import crypto from 'crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { requireRole } from '../../lib/middleware/rbac.js';
import { withTenantContext } from '../../config/db.js';
import { parseTrialBalance } from '../../../../../agent/parser/parser-agent.js';
import { classifyAccounts } from '../../../../../agent/mapping/mapping-agent.js';
import { enqueueProvisionRun, agentQueue } from '../../../../../agent/orchestrator/state-machine.js';
import { logger } from '../../lib/logger.js';

export const agentRoutes = new Hono();
agentRoutes.use('*', authMiddleware);

agentRoutes.post('/parse',
  zValidator('json', z.object({
    rawContent: z.string(),
    source: z.enum(['csv', 'pdf']),
  })),
  async (c) => {
    const { rawContent, source } = c.req.valid('json');
    const result = await parseTrialBalance(rawContent, source);
    return c.json(result);
  },
);

agentRoutes.post('/map',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', z.object({
    parsedItems: z.array(z.object({
      accountNumber: z.string(),
      accountName: z.string(),
      accountType: z.enum(['Income', 'Expense', 'Asset', 'Liability', 'Equity']),
      debit: z.string(),
      credit: z.string(),
      balance: z.string(),
    })),
    jurisdiction: z.enum(['US_ASC740', 'UK_FRS102_S29']),
  })),
  async (c) => {
    const user = c.get('user');
    return withTenantContext(user.tenantId, async (tx) => {
      const { parsedItems, jurisdiction } = c.req.valid('json');
      const result = await classifyAccounts(parsedItems, jurisdiction as any);
      return c.json(result);
    });
  },
);

const pipelineSchema = z.object({
  jurisdiction: z.enum(['US_ASC740', 'UK_FRS102_S29']),
  rawInput: z.string().optional(),
});

agentRoutes.post('/pipeline',
  requireRole('preparer', 'reviewer', 'partner', 'admin'),
  zValidator('json', pipelineSchema),
  async (c) => {
    const user = c.get('user');
    return withTenantContext(user.tenantId, async (tx) => {
      const { jurisdiction, rawInput } = c.req.valid('json');
      const jobId = crypto.randomUUID();
      const job = await enqueueProvisionRun(jobId, jurisdiction, rawInput);
      logger.info({ jobId: job.id, jurisdiction }, 'Agent pipeline enqueued');
      return c.json({ jobId: job.id, status: 'queued' }, 202);
    });
  },
);

agentRoutes.get('/pipeline/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await agentQueue.getJob(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  const state = await job.getState();
  const progress = await job.progress;
  const result = job.returnvalue;
  return c.json({ jobId, state, progress, result });
});
