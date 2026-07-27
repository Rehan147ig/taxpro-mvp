import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { connections } from '../../db/schema/connections.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { encryptSecret } from '../../lib/crypto.js';
import { syncNetSuite } from './connector/sync-orchestrator.js';

export const netsuiteRoutes = new Hono();
netsuiteRoutes.use('*', authMiddleware);

const createConnectionSchema = z.object({
  label: z.string().min(1),
  accountId: z.string().min(1),
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
  realm: z.string().min(1),
  baseUrl: z.string().min(1),
});

netsuiteRoutes.post('/connections', zValidator('json', createConnectionSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.insert(connections).values({
      tenantId: user.tenantId,
      label: body.label,
      accountId: body.accountId,
      consumerKey: encryptSecret(body.consumerKey),
      consumerSecret: encryptSecret(body.consumerSecret),
      tokenId: encryptSecret(body.tokenId),
      tokenSecret: encryptSecret(body.tokenSecret),
      realm: body.realm,
      baseUrl: body.baseUrl,
    }).returning();

    return c.json(redactConnection(conn), 201);
  });
});

netsuiteRoutes.get('/connections', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const conns = await tx.select().from(connections).where(eq(connections.tenantId, user.tenantId));
    return c.json(conns.map(redactConnection));
  });
});

netsuiteRoutes.get('/connections/:id', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, c.req.param('id'))).limit(1);
    if (!conn || conn.tenantId !== user.tenantId) throw new NotFoundError('Connection', c.req.param('id'));
    return c.json(redactConnection(conn));
  });
});

netsuiteRoutes.delete('/connections/:id', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, c.req.param('id'))).limit(1);
    if (!conn || conn.tenantId !== user.tenantId) throw new NotFoundError('Connection', c.req.param('id'));
    await tx.delete(connections).where(eq(connections.id, conn.id));
    return c.json({ deleted: true });
  });
});

netsuiteRoutes.post('/connections/:id/sync', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, c.req.param('id'))).limit(1);
    if (!conn || conn.tenantId !== user.tenantId) throw new NotFoundError('Connection', c.req.param('id'));

    await tx.update(connections).set({
      syncStatus: 'syncing',
      updatedAt: new Date(),
    }).where(eq(connections.id, conn.id));

    try {
      const result = await syncNetSuite(conn.id);
      return c.json({
        status: 'completed',
        ...result,
      });
    } catch (err: any) {
      await tx.update(connections).set({
        syncStatus: 'error',
        updatedAt: new Date(),
      }).where(eq(connections.id, conn.id));
      throw new BadRequestError(`Sync failed: ${err.message}`);
    }
  });
});

function redactConnection(conn: typeof connections.$inferSelect) {
  return {
    ...conn,
    consumerKey: conn.consumerKey ? '********' : '',
    consumerSecret: conn.consumerSecret ? '********' : '',
    tokenId: conn.tokenId ? '********' : '',
    tokenSecret: conn.tokenSecret ? '********' : '',
  };
}
