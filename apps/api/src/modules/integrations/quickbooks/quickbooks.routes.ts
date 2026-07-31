import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenantContext } from '../../../config/db.js';
import { qboConnections } from '../../../db/schema/qbo-connections.js';
import { entities } from '../../../db/schema/entities.js';
import { accounts } from '../../../db/schema/accounts.js';
import { trialBalance } from '../../../db/schema/trial-balance.js';
import { authMiddleware } from '../../../lib/middleware/auth.js';
import { getUser } from '../../../lib/middleware/rbac.js';
import { BadRequestError } from '../../../lib/errors.js';
import { buildQboAuthUrl, exchangeQboCode, refreshQboTokens, fetchQboTrialBalance, encryptToken, decryptToken, QBO_BASE_URLS } from './quickbooks-client.js';

export const qboRoutes = new Hono();
qboRoutes.use('*', authMiddleware);

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID ?? '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET ?? '';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI ?? 'http://localhost:3000/api/qbo/callback';
const QBO_ENV = process.env.QBO_ENV === 'production' ? 'production' : 'sandbox';

const connectSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
  label: z.string().max(255).optional(),
});

qboRoutes.post('/auth-url', async (c) => {
  const user = getUser(c);
  if (!QBO_CLIENT_ID) throw new BadRequestError('QBO_CLIENT_ID not configured on the server');
  const { url, state } = buildQboAuthUrl({ clientId: QBO_CLIENT_ID, redirectUri: QBO_REDIRECT_URI });
  return c.json({ url, state, tenantId: user.tenantId });
});

qboRoutes.post('/callback', zValidator('json', connectSchema), async (c) => {
  const user = getUser(c);
  const { code, label } = c.req.valid('json');
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) throw new BadRequestError('QBO app credentials not configured');

  const tokens = await exchangeQboCode({ code, clientId: QBO_CLIENT_ID, clientSecret: QBO_CLIENT_SECRET, redirectUri: QBO_REDIRECT_URI });
  // realmId comes from the original redirect (OAuth 2.0 qbo flow appends it) —
  // the token payload carries it under realmId; fall back to a placeholder.
  const realmId = (tokens as any).realmId ?? 'realm-pending';

  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.insert(qboConnections).values({
      tenantId: user.tenantId,
      label: label ?? 'QuickBooks Online',
      realmId,
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: encryptToken(tokens.refreshToken),
      tokenExpiresAt: new Date(tokens.expiresAt),
      syncStatus: 'connected',
    }).returning();
    return c.json({ id: conn.id, realmId, environment: QBO_ENV, expiresAt: tokens.expiresAt });
  });
});

qboRoutes.get('/connections', async (c) => {
  const user = getUser(c);
  return withTenantContext(user.tenantId, async (tx) => {
    const conns = await tx.select({
      id: qboConnections.id,
      label: qboConnections.label,
      realmId: qboConnections.realmId,
      syncStatus: qboConnections.syncStatus,
      lastSyncedAt: qboConnections.lastSyncedAt,
    }).from(qboConnections).where(eq(qboConnections.tenantId, user.tenantId));
    return c.json(conns);
  });
});

qboRoutes.post('/connections/:id/sync', zValidator('json', z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityName: z.string().max(255).optional(),
})), async (c) => {
  const user = getUser(c);
  const { periodStart, periodEnd, entityName } = c.req.valid('json');
  const connId = c.req.param('id');
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) throw new BadRequestError('QBO app credentials not configured');

  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.select().from(qboConnections)
      .where(and(eq(qboConnections.id, connId), eq(qboConnections.tenantId, user.tenantId))).limit(1);
    if (!conn) throw new BadRequestError('QBO connection not found');

    let accessToken = decryptToken(conn.accessToken);
    if (new Date(conn.tokenExpiresAt).getTime() < Date.now() + 60_000) {
      const refreshed = await refreshQboTokens({ refreshToken: decryptToken(conn.refreshToken), clientId: QBO_CLIENT_ID, clientSecret: QBO_CLIENT_SECRET });
      accessToken = refreshed.accessToken;
      await tx.update(qboConnections).set({
        accessToken: encryptToken(refreshed.accessToken),
        refreshToken: encryptToken(refreshed.refreshToken),
        tokenExpiresAt: new Date(refreshed.expiresAt),
        updatedAt: new Date(),
      }).where(eq(qboConnections.id, conn.id));
    }

    const tb = await fetchQboTrialBalance({
      accessToken,
      realmId: conn.realmId,
      periodStart,
      periodEnd,
      baseUrl: QBO_ENV === 'sandbox' ? QBO_BASE_URLS.sandbox : QBO_BASE_URLS.production,
    });

    const [entity] = await tx.insert(entities).values({
      tenantId: user.tenantId,
      externalId: conn.realmId,
      name: entityName ?? conn.label,
      type: 'domestic',
      currency: 'USD',
      isConsolidated: true,
      taxJurisdiction: 'US-Federal',
    }).onConflictDoUpdate({
      target: [entities.tenantId, entities.externalId],
      set: { name: entityName ?? conn.label, updatedAt: new Date() },
    }).returning();
    const entityId = entity.id;

    const fiscalYear = Number(periodEnd.slice(0, 4));
    let inserted = 0;
    for (const line of tb.lines) {
      if (!line.accountName) continue;
      const code = line.accountName.split(':')[0].trim().slice(0, 50);
      const [account] = await tx.insert(accounts).values({
        tenantId: user.tenantId,
        externalId: code || line.accountName,
        accountNumber: code || null,
        name: line.accountName,
        type: guessQboAccountType(line.accountName),
        isSummary: false,
      }).onConflictDoUpdate({
        target: [accounts.tenantId, accounts.externalId],
        set: { name: line.accountName, type: guessQboAccountType(line.accountName), updatedAt: new Date() },
      }).returning();

      await tx.insert(trialBalance).values({
        tenantId: user.tenantId,
        entityId,
        accountId: account.id,
        period: periodEnd,
        periodEnd,
        fiscalYear,
        fiscalPeriod: fiscalYear,
        balance: String(line.balance),
        source: 'qbo',
      }).onConflictDoUpdate({
        target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
        set: { balance: String(line.balance) },
      });
      inserted++;
    }

    await tx.update(qboConnections).set({ lastSyncedAt: new Date(), syncStatus: 'synced' }).where(eq(qboConnections.id, conn.id));
    return c.json({ periodStart, periodEnd, linesFetched: tb.lines.length, rowsImported: inserted });
  });
});

function guessQboAccountType(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (/\b(sales|revenue|income|service fees)\b/.test(n)) return 'Income';
  if (/\b(cost of sales|cogs)\b/.test(n)) return 'COGS';
  if (/\b(rent|salary|wages|insurance|advertising|utilities|postage|travel|repairs|office)\b/.test(n)) return 'Expense';
  if (/\b(tax|vat|paye)\b/.test(n)) return 'TaxLiability';
  return 'BalanceSheet';
}
