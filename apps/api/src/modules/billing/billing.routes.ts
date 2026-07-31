import { Hono } from 'hono';
import { withTenantContext } from '../../config/db.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { getUser } from '../../lib/middleware/rbac.js';
import { BadRequestError } from '../../lib/errors.js';
import { summarizeUsage, buildInvoiceLines, pricePerProvision } from './usage.js';

export const billingRoutes = new Hono();
billingRoutes.use('*', authMiddleware);

billingRoutes.get('/usage', async (c) => {
  const user = getUser(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (from && !/^\d{4}-\d{2}-\d{2}/.test(from)) throw new BadRequestError('from must be an ISO date');
  if (to && !/^\d{4}-\d{2}-\d{2}/.test(to)) throw new BadRequestError('to must be an ISO date');

  return withTenantContext(user.tenantId, async (tx) => {
    const summary = await summarizeUsage(tx, { tenantId: user.tenantId, from, to });
    return c.json({ ...summary, pricePerProvision: pricePerProvision() });
  });
});

billingRoutes.get('/invoice', async (c) => {
  const user = getUser(c);
  const from = c.req.query('from');
  const to = c.req.query('to') ?? new Date().toISOString().slice(0, 10);
  return withTenantContext(user.tenantId, async (tx) => {
    const invoice = await buildInvoiceLines(tx, { tenantId: user.tenantId, from, to });
    return c.json({ tenantId: user.tenantId, invoice });
  });
});
