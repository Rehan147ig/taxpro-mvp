import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenantContext } from '../../../config/db.js';
import { xeroConnections } from '../../../db/schema/xero-connections.js';
import { entities } from '../../../db/schema/entities.js';
import { accounts } from '../../../db/schema/accounts.js';
import { trialBalance } from '../../../db/schema/trial-balance.js';
import { authMiddleware } from '../../../lib/middleware/auth.js';
import { getUser } from '../../../lib/middleware/rbac.js';
import { BadRequestError } from '../../../lib/errors.js';
import { encryptToken, decryptToken, buildAuthUrl, exchangeCode, refreshTokens, fetchTrialBalance, listOrganisations } from './xero-client.js';

export const xeroRoutes = new Hono();
xeroRoutes.use('*', authMiddleware);

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID ?? '';
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET ?? '';
const XERO_REDIRECT_URI = process.env.XERO_REDIRECT_URI ?? 'http://localhost:3000/api/xero/callback';

const connectSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
  codeVerifier: z.string().optional(),
  label: z.string().max(255).optional(),
});

xeroRoutes.post('/auth-url', async (c) => {
  const user = getUser(c);
  if (!XERO_CLIENT_ID) throw new BadRequestError('XERO_CLIENT_ID not configured on the server');
  const { url, codeVerifier, state } = buildAuthUrl({
    clientId: XERO_CLIENT_ID,
    redirectUri: XERO_REDIRECT_URI,
  });
  // code_verifier must survive the browser round-trip; it is returned to the
  // client and posted back with the callback. (MVP compromise — in production
  // keep it server-side keyed by state.)
  return c.json({ url, state, codeVerifier, tenantId: user.tenantId });
});

xeroRoutes.post('/callback', zValidator('json', connectSchema), async (c) => {
  const user = getUser(c);
  const { code, codeVerifier } = c.req.valid('json');
  if (!codeVerifier) throw new BadRequestError('codeVerifier is required (request a fresh auth-url)');
  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new BadRequestError('Xero app credentials not configured');

  const tokens = await exchangeCode({ code, clientId: XERO_CLIENT_ID, clientSecret: XERO_CLIENT_SECRET, redirectUri: XERO_REDIRECT_URI, codeVerifier });
  const orgs = await listOrganisations(tokens.accessToken);
  if (orgs.length === 0) throw new BadRequestError('No Xero organisations connected to this app');

  return withTenantContext(user.tenantId, async (tx) => {
    const first = orgs[0];
    const [conn] = await tx.insert(xeroConnections).values({
      tenantId: user.tenantId,
      label: c.req.valid('json').label ?? `Xero — ${first.name}`,
      xeroTenantId: first.tenantId,
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: encryptToken(tokens.refreshToken),
      tokenExpiresAt: new Date(tokens.expiresAt),
      syncStatus: 'connected',
    }).returning();
    return c.json({ id: conn.id, organisation: first.name, expiresAt: tokens.expiresAt });
  });
});

xeroRoutes.get('/connections', async (c) => {
  const user = getUser(c);
  return withTenantContext(user.tenantId, async (tx) => {
    const conns = await tx.select({
      id: xeroConnections.id,
      label: xeroConnections.label,
      xeroTenantId: xeroConnections.xeroTenantId,
      syncStatus: xeroConnections.syncStatus,
      lastSyncedAt: xeroConnections.lastSyncedAt,
    }).from(xeroConnections).where(eq(xeroConnections.tenantId, user.tenantId));
    return c.json(conns);
  });
});

xeroRoutes.post('/connections/:id/sync', zValidator('json', z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityName: z.string().max(255).optional(),
})), async (c) => {
  const user = getUser(c);
  const { periodStart, periodEnd, entityName } = c.req.valid('json');
  const connId = c.req.param('id');
  if (!XERO_CLIENT_ID || !XERO_CLIENT_SECRET) throw new BadRequestError('Xero app credentials not configured');

  return withTenantContext(user.tenantId, async (tx) => {
    const [conn] = await tx.select().from(xeroConnections)
      .where(and(eq(xeroConnections.id, connId), eq(xeroConnections.tenantId, user.tenantId))).limit(1);
    if (!conn) throw new BadRequestError('Xero connection not found');

    let accessToken = decryptToken(conn.accessToken);
    if (new Date(conn.tokenExpiresAt).getTime() < Date.now() + 60_000) {
      const refreshed = await refreshTokens({ refreshToken: decryptToken(conn.refreshToken), clientId: XERO_CLIENT_ID, clientSecret: XERO_CLIENT_SECRET });
      accessToken = refreshed.accessToken;
      await tx.update(xeroConnections).set({
        accessToken: encryptToken(refreshed.accessToken),
        refreshToken: encryptToken(refreshed.refreshToken),
        tokenExpiresAt: new Date(refreshed.expiresAt),
        updatedAt: new Date(),
      }).where(eq(xeroConnections.id, conn.id));
    }

    const tb = await fetchTrialBalance({ accessToken, xeroTenantId: conn.xeroTenantId, periodStart, periodEnd });

    // Import into the provisioning data model (same shape the upload route produces).
    const [entity] = await tx.insert(entities).values({
      tenantId: user.tenantId,
      externalId: conn.xeroTenantId,
      name: entityName ?? conn.label,
      type: 'domestic',
      currency: 'GBP',
      isConsolidated: true,
      taxJurisdiction: 'UK',
    }).onConflictDoUpdate({
      target: [entities.tenantId, entities.externalId],
      set: { name: entityName ?? conn.label, updatedAt: new Date() },
    }).returning();
    const entityId = entity.id;

    const periodKey = periodEnd;
    const fiscalYear = Number(periodEnd.slice(0, 4));
    let inserted = 0;
    for (const line of tb.lines) {
      if (!line.accountCode) continue;
      const [account] = await tx.insert(accounts).values({
        tenantId: user.tenantId,
        externalId: line.accountCode,
        accountNumber: line.accountCode,
        name: line.accountName || line.accountCode,
        type: guessAccountType(line.accountName),
        isSummary: false,
      }).onConflictDoUpdate({
        target: [accounts.tenantId, accounts.externalId],
        set: { name: line.accountName || line.accountCode, type: guessAccountType(line.accountName), updatedAt: new Date() },
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
        source: 'xero',
      }).onConflictDoUpdate({
        target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
        set: { balance: String(line.balance) },
      });
      inserted++;
    }

    await tx.update(xeroConnections).set({ lastSyncedAt: new Date(), syncStatus: 'synced' }).where(eq(xeroConnections.id, conn.id));
    return c.json({ periodStart, periodEnd, linesFetched: tb.lines.length, rowsImported: inserted });
  });
});

function guessAccountType(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (/\b(sales|revenue|income|service fees)\b/.test(n)) return 'Income';
  if (/\b(cost of sales|cogs)\b/.test(n)) return 'COGS';
  if (/\b(rent|salary|wages|insurance|advertising|utilities|postage|travel|repairs)\b/.test(n)) return 'Expense';
  if (/\b(tax|vat|national insurance|paye)\b/.test(n)) return 'TaxLiability';
  if (/\b(debtors|creditors|cash|bank|stock|inventory|equipment|vehicles|prepayments|accruals)\b/.test(n)) return 'BalanceSheet';
  return 'BalanceSheet';
}
