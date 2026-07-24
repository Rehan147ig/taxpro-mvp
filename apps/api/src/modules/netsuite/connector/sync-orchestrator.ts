import { db, pool } from '../../../config/db.js';
import { entities } from '../../../db/schema/entities.js';
import { accounts } from '../../../db/schema/accounts.js';
import { trialBalance } from '../../../db/schema/trial-balance.js';
import { connections } from '../../../db/schema/connections.js';
import { NetSuiteClient, NetSuiteConfig, TrialBalanceRow } from './client.js';
import { decryptSecret } from '../../../lib/crypto.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../../../lib/logger.js';

/**
 * Sync orchestrator: pulls subsidiaries, chart of accounts, and trial balance
 * from NetSuite and stores them in the local database.
 *
 * Uses Postgres advisory locks to prevent concurrent syncs for the same connection.
 * Runs inside a database transaction for atomicity.
 */

interface SyncResult {
  entitiesSynced: number;
  accountsSynced: number;
  tbRowsSynced: number;
  durationMs: number;
}

const LOCK_KEY_PREFIX = 0x10A5C0; // Namespace for advisory locks ('TAXPRO' in hex-free int form)

export async function syncNetSuite(connectionId: string): Promise<SyncResult> {
  const start = Date.now();
  const lockKey = LOCK_KEY_PREFIX + hashCode(connectionId);

  // ── Advisory lock to prevent concurrent syncs ──
  const lockClient = await pool.connect();
  try {
    const acquired = await lockClient.query(
      'SELECT pg_try_advisory_lock($1) AS locked', [lockKey],
    );
    if (!acquired.rows[0]?.locked) {
      throw new Error(
        `Sync already in progress for connection ${connectionId}. ` +
        'Wait for the current sync to finish, or restart the server to release the lock.',
      );
    }
  } finally {
    lockClient.release();
  }

  try {
    // ── Run sync inside a transaction ──
    return await db.transaction(async (tx) => {
      // 1. Get connection config from DB
      const [conn] = await tx.select().from(connections)
        .where(eq(connections.id, connectionId))
        .limit(1);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);

      await tx.update(connections).set({
        syncStatus: 'syncing',
        updatedAt: new Date(),
      }).where(eq(connections.id, connectionId));

      const nsConfig: NetSuiteConfig = {
        consumerKey: decryptSecret(conn.consumerKey),
        consumerSecret: decryptSecret(conn.consumerSecret),
        tokenId: decryptSecret(conn.tokenId),
        tokenSecret: decryptSecret(conn.tokenSecret),
        realm: conn.realm,
        baseUrl: conn.baseUrl,
      };

      const client = new NetSuiteClient(nsConfig);

      // 2. Sync subsidiaries → entities
      const nsEntities = await client.getSubsidiaries();
      let entitiesSynced = 0;

      for (const sub of nsEntities) {
        try {
          await tx.insert(entities).values({
            tenantId: conn.tenantId,
            externalId: sub.id,
            name: (sub.name as string) || `Subsidiary ${sub.id}`,
            type: 'domestic',
            currency: (sub.currency as string) || 'USD',
            isConsolidated: true,
            taxJurisdiction: 'US-Federal',
          }).onConflictDoUpdate({
            target: [entities.tenantId, entities.externalId],
            set: {
              name: (sub.name as string) || `Subsidiary ${sub.id}`,
              updatedAt: new Date(),
            },
          });
          entitiesSynced++;
        } catch (err) {
          logger.error({ err, entityId: sub.id }, '[Sync] Failed to sync entity');
        }
      }

      // 3. Sync chart of accounts
      const nsAccounts = await client.getChartOfAccounts();
      let accountsSynced = 0;

      for (const acct of nsAccounts) {
        try {
          const acctType = mapNetSuiteAccountType(acct.accttype);
          await tx.insert(accounts).values({
            tenantId: conn.tenantId,
            externalId: acct.id,
            accountNumber: acct.acctnumber,
            name: acct.name,
            type: acctType,
            detailType: acct.accttype || undefined,
            isSummary: false,
          }).onConflictDoUpdate({
            target: [accounts.tenantId, accounts.externalId],
            set: {
              name: acct.name,
              accountNumber: acct.acctnumber,
              updatedAt: new Date(),
            },
          });
          accountsSynced++;
        } catch (err) {
          logger.error({ err, accountId: acct.id }, '[Sync] Failed to sync account');
        }
      }

      // 4. Sync trial balance
      const currentYear = new Date().getFullYear();
      const startDate = `${currentYear}-01-01`;
      const endDate = `${currentYear}-12-31`;

      const syncedEntities = await tx.select().from(entities)
        .where(eq(entities.tenantId, conn.tenantId));
      const entityMap = new Map(syncedEntities.map(e => [e.externalId, e.id]));

      let tbRowsSynced = 0;

      for (const nsEntity of syncedEntities) {
        try {
          const rows = await client.getTrialBalance(startDate, endDate, nsEntity.externalId);

          for (const row of rows) {
            const [acct] = await tx.select().from(accounts)
              .where(and(
                eq(accounts.tenantId, conn.tenantId),
                eq(accounts.externalId, row.account_id),
              ))
              .limit(1);
            if (!acct) continue;

            const entityId = entityMap.get(row.subsidiary_id);
            if (!entityId) continue;

            await tx.insert(trialBalance).values({
              tenantId: conn.tenantId,
              entityId,
              accountId: acct.id,
              period: startDate,
              periodEnd: endDate,
              fiscalYear: currentYear,
              fiscalPeriod: 0,
              debit: row.debit || '0',
              credit: row.credit || '0',
              balance: row.balance || '0',
              source: 'netsuite',
            }).onConflictDoUpdate({
              target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
              set: {
                balance: row.balance || '0',
                debit: row.debit || '0',
                credit: row.credit || '0',
              },
            });

            tbRowsSynced++;
          }
        } catch (err) {
          logger.error({ err, entityId: nsEntity.externalId }, '[Sync] Failed to sync trial balance');
        }
      }

      // 5. Update connection sync status
      await tx.update(connections).set({
        syncStatus: 'idle',
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(connections.id, connectionId));

      const durationMs = Date.now() - start;
      return { entitiesSynced, accountsSynced, tbRowsSynced, durationMs };
    });
  } finally {
    // Release the advisory lock
    const lockClient2 = await pool.connect();
    try {
      await lockClient2.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    } finally {
      lockClient2.release();
    }
  }
}

function mapNetSuiteAccountType(nsType: string): string {
  const typeMap: Record<string, string> = {
    'Accounts Receivable': 'Asset',
    'Accounts Payable': 'Liability',
    'Bank': 'Asset',
    'Cost of Goods Sold': 'Expense',
    'Credit Card': 'Liability',
    'Deferred Expense': 'Asset',
    'Deferred Revenue': 'Liability',
    'Equity': 'Equity',
    'Expense': 'Expense',
    'Fixed Asset': 'Asset',
    'Income': 'Income',
    'Long Term Liability': 'Liability',
    'Non-Posting': 'Equity',
    'Other Asset': 'Asset',
    'Other Current Asset': 'Asset',
    'Other Current Liability': 'Liability',
    'Other Expense': 'Expense',
    'Other Income': 'Income',
    'Other Liability': 'Liability',
    'Overseas': 'Expense',
    'Statistical': 'Equity',
    'Stock': 'Equity',
    'Unbilled Receivable': 'Asset',
  };
  return typeMap[nsType] || 'Expense';
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
