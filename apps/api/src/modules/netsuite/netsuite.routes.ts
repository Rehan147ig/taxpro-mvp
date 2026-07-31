import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { connections } from '../../db/schema/connections.js';
import { entities } from '../../db/schema/entities.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { provisionResults } from '../../db/schema/provision-results.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { requireMinimumRole, ensureTenantScoped } from '../../lib/middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { encryptSecret, decryptSecret } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { auditSensitiveOp } from '../provision/audit.js';
import { NetSuiteClient, NetSuiteConfig } from './connector/client.js';
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

const postJournalEntrySchema = z.object({
  provisionResultId: z.string().uuid(),
  connectionId: z.string().uuid().optional(),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().max(200).optional(),
  subsidiaryId: z.string().optional(),
  /** Maps engine synthetic account ids (e.g. 'tax-payable') to NetSuite account internal ids. */
  accountMap: z.record(z.string(), z.string()).optional(),
});

netsuiteRoutes.post('/post-journal-entry', requireMinimumRole('reviewer'), zValidator('json', postJournalEntrySchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  return withTenantContext(user.tenantId, async (tx) => {
    const [result] = await tx.select().from(provisionResults)
      .where(eq(provisionResults.id, body.provisionResultId))
      .limit(1);
    if (!result) throw new NotFoundError('Provision result', body.provisionResultId);
    ensureTenantScoped(user.tenantId, result.tenantId);

    const [run] = await tx.select().from(provisionRuns)
      .where(eq(provisionRuns.id, result.provisionRunId ?? ''))
      .limit(1);
    if (!run) throw new NotFoundError('Provision run', result.provisionRunId ?? '');
    ensureTenantScoped(user.tenantId, run.tenantId);

    if (run.approvalStatus !== 'approved' && run.status !== 'locked') {
      throw new BadRequestError(
        'Provision must be approved or locked before journal entries can be posted to NetSuite.',
      );
    }

    const detail = result.detail as any;
    const journalEntries: { type: string; period: string; lines: { accountId: string; debit: number; credit: number; memo?: string }[] }[] =
      detail?.journalEntries ?? [];
    if (journalEntries.length === 0) {
      throw new BadRequestError('Provision result contains no journal entries.');
    }

    const accountMap = body.accountMap ?? {};
    const linesSkipped: string[] = [];
    const postedLines: { accountId: string; debit: number; credit: number; memo?: string }[] = [];
    for (const entry of journalEntries) {
      for (const line of entry.lines) {
        const nsAccountId = accountMap[line.accountId];
        if (!nsAccountId) {
          linesSkipped.push(line.accountId);
          continue;
        }
        postedLines.push({
          accountId: nsAccountId,
          debit: line.debit,
          credit: line.credit,
          memo: `${line.memo ?? ''} [${entry.type}]`,
        });
      }
    }
    if (postedLines.length === 0) {
      throw new BadRequestError(
        `No journal lines could be mapped to NetSuite accounts. Provide accountMap entries for: ${[...new Set(journalEntries.flatMap(e => e.lines.map(l => l.accountId)))].join(', ')}`,
      );
    }

    let conn: typeof connections.$inferSelect | undefined;
    if (body.connectionId) {
      const [byId] = await tx.select().from(connections).where(eq(connections.id, body.connectionId)).limit(1);
      if (!byId || byId.tenantId !== user.tenantId) throw new NotFoundError('Connection', body.connectionId);
      conn = byId;
    } else {
      const [first] = await tx.select().from(connections)
        .where(eq(connections.tenantId, user.tenantId))
        .orderBy(connections.createdAt)
        .limit(1);
      conn = first;
    }
    if (!conn) throw new BadRequestError('No NetSuite connection configured for this tenant.');

    let subsidiaryId = body.subsidiaryId;
    if (!subsidiaryId && run.entityId) {
      const [entity] = await tx.select().from(entities).where(eq(entities.id, run.entityId)).limit(1);
      if (entity && entity.externalId) subsidiaryId = entity.externalId;
    }
    if (!subsidiaryId) {
      throw new BadRequestError('No subsidiaryId provided and the provision run has no synced NetSuite entity.');
    }

    const nsConfig: NetSuiteConfig = {
      consumerKey: decryptSecret(conn.consumerKey),
      consumerSecret: decryptSecret(conn.consumerSecret),
      tokenId: decryptSecret(conn.tokenId),
      tokenSecret: decryptSecret(conn.tokenSecret),
      realm: conn.realm,
      baseUrl: conn.baseUrl,
    };
    const client = new NetSuiteClient(nsConfig);

    const postingDate = body.postingDate ?? new Date().toISOString().slice(0, 10);
    const baseMemo = body.memo ?? `TaxPro provision ${result.period}`;
    const netSuiteJournalIds: string[] = [];
    let entriesPosted = 0;

    for (const entry of journalEntries) {
      const entryLines = entry.lines
        .map((line) => {
          const nsAccountId = accountMap[line.accountId];
          return nsAccountId ? { ...line, accountId: nsAccountId } : null;
        })
        .filter((l): l is { accountId: string; debit: number; credit: number; memo?: string } => l !== null);
      if (entryLines.length === 0) continue;

      try {
        const { id } = await client.postJournalEntry({
          subsidiaryId,
          trandate: postingDate,
          memo: `${baseMemo} — ${entry.type}`,
          lines: entryLines,
        });
        netSuiteJournalIds.push(id);
        entriesPosted++;
      } catch (err: any) {
        throw new BadRequestError(`NetSuite journal entry posting failed for ${entry.type}: ${err.message}`);
      }
    }

    await auditSensitiveOp(tx, {
      tenantId: user.tenantId,
      runId: run.id,
      action: 'run.posted_to_netsuite',
      actorUserId: user.userId,
      actorRole: user.role,
      details: {
        provisionResultId: result.id,
        connectionId: conn.id,
        subsidiaryId,
        postingDate,
        netSuiteJournalIds,
        linesSkipped,
        entriesPosted,
      },
      requestId: c.get('requestId'),
    });

    logger.info({
      tenantId: user.tenantId,
      runId: run.id,
      netSuiteJournalIds,
      linesSkipped,
    }, '[NetSuite] Journal entries posted');

    return c.json({
      posted: true,
      netSuiteJournalIds,
      entriesPosted,
      linesSkipped,
      postingDate,
      memo: baseMemo,
    }, 201);
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
