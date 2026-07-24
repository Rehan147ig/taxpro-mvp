import { z } from 'zod';
import { db } from '../../config/db.js';
import { trialBalance } from '../../db/schema/trial-balance.js';
import { entities } from '../../db/schema/entities.js';
import { accounts } from '../../db/schema/accounts.js';
import { eq, and, gte, lte } from 'drizzle-orm';

const parameters = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', description: 'The tenant/company ID' },
    period: { type: 'string', description: 'Start of the period in YYYY-MM-DD format' },
    endPeriod: { type: 'string', description: 'End of the period in YYYY-MM-DD format (defaults to period)' },
    entityId: { type: 'string', description: 'Optional entity/subsidiary ID to filter by' },
  },
  required: ['tenantId', 'period'],
  additionalProperties: false,
};

export const fetchTrialBalance = {
  spec: {
    description: 'Fetch General Ledger trial balance data for a tenant and period. Returns account balances grouped by account with account metadata.',
    parameters,
  },
  execute: async (args: Record<string, any>) => {
    const { tenantId, period, endPeriod, entityId } = args;
    const periodEnd = endPeriod ?? period;

    const tbRows = await db.select().from(trialBalance)
      .where(and(
        eq(trialBalance.tenantId, tenantId),
        gte(trialBalance.period, period),
        lte(trialBalance.period, periodEnd),
        ...(entityId ? [eq(trialBalance.entityId, entityId)] : []),
      ));

    if (tbRows.length === 0) {
      return { count: 0, rows: [], message: 'No trial balance data found for this period.' };
    }

    const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId));
    const accountMap = new Map(accountRows.map(a => [a.id, a]));
    const entityRows = await db.select().from(entities).where(eq(entities.tenantId, tenantId));
    const entityMap = new Map(entityRows.map(e => [e.id, e]));

    const rows = tbRows.map(r => ({
      accountId: r.accountId,
      accountNumber: accountMap.get(r.accountId)?.accountNumber ?? '',
      accountName: accountMap.get(r.accountId)?.name ?? '',
      accountType: accountMap.get(r.accountId)?.type ?? '',
      entityId: r.entityId,
      entityName: entityMap.get(r.entityId)?.name ?? '',
      period: r.period,
      periodEnd: r.periodEnd,
      debit: Number(r.debit ?? 0),
      credit: Number(r.credit ?? 0),
      balance: Number(r.balance ?? 0),
    }));

    const byAccount = new Map<string, { accountId: string; accountName: string; accountNumber: string; accountType: string; netBalance: number }>();
    for (const r of rows) {
      const key = r.accountId;
      const existing = byAccount.get(key);
      if (existing) existing.netBalance += r.balance;
      else byAccount.set(key, { accountId: r.accountId, accountName: r.accountName, accountNumber: r.accountNumber, accountType: r.accountType, netBalance: r.balance });
    }

    return {
      count: rows.length,
      groupedAccounts: Array.from(byAccount.values()),
      rows,
      message: `Found ${rows.length} trial balance rows across ${byAccount.size} accounts.`,
    };
  },
};
