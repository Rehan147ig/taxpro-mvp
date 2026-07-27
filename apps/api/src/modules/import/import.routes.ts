import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { withTenantContext } from '../../config/db.js';
import { accounts } from '../../db/schema/accounts.js';
import { entities } from '../../db/schema/entities.js';
import { trialBalance } from '../../db/schema/trial-balance.js';
import { taxMappings } from '../../db/schema/tax-mappings.js';
import { reviewItems } from '../../db/schema/review-items.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { BadRequestError } from '../../lib/errors.js';
import { addAutoMappingJob, autoMappingQueue } from './auto-mapping/auto-mapping.queue.js';

export const importRoutes = new Hono();
importRoutes.use('*', authMiddleware);

const importSchema = z.object({
  csv: z.string().min(1),
  source: z.string().min(1).max(20).default('csv'),
});

type ImportRow = Record<string, string>;

const csvTemplate = [
  'entity,entityName,accountNumber,accountName,accountType,period,periodEnd,debit,credit,balance,currency',
  'Acme US Inc.,Acme US Inc.,4000,Subscription revenue,Income,2026-01-01,2026-12-31,0,4800000,-4800000,USD',
  'Acme US Inc.,Acme US Inc.,5000,Salaries and wages,Expense,2026-01-01,2026-12-31,1600000,0,1600000,USD',
].join('\n');

importRoutes.get('/trial-balance/template', (c) => {
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="taxpro-trial-balance-template.csv"');
  return c.body(csvTemplate);
});

importRoutes.post('/trial-balance', zValidator('json', importSchema), async (c) => {
  const user = c.get('user');
  const { csv, source } = c.req.valid('json');
  const rows = parseCsv(csv);

  if (rows.length === 0) throw new BadRequestError('CSV did not contain any data rows');

  return withTenantContext(user.tenantId, async (tx) => {
    let importedRows = 0;
    const importedAccountIds = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const lineNumber = index + 2;
      const normalized = normalizeRow(row, lineNumber);

      const [entity] = await tx.insert(entities).values({
        tenantId: user.tenantId,
        externalId: normalized.entityExternalId,
        name: normalized.entityName,
        type: 'domestic',
        currency: normalized.currency,
        isConsolidated: true,
        taxJurisdiction: normalized.taxJurisdiction,
      }).onConflictDoUpdate({
        target: [entities.tenantId, entities.externalId],
        set: {
          name: normalized.entityName,
          currency: normalized.currency,
          updatedAt: new Date(),
        },
      }).returning();

      const [account] = await tx.insert(accounts).values({
        tenantId: user.tenantId,
        externalId: normalized.accountExternalId,
        accountNumber: normalized.accountNumber,
        name: normalized.accountName,
        type: normalized.accountType,
        detailType: normalized.detailType,
        isSummary: false,
      }).onConflictDoUpdate({
        target: [accounts.tenantId, accounts.externalId],
        set: {
          accountNumber: normalized.accountNumber,
          name: normalized.accountName,
          type: normalized.accountType,
          detailType: normalized.detailType,
          updatedAt: new Date(),
        },
      }).returning();

      await tx.insert(trialBalance).values({
        tenantId: user.tenantId,
        entityId: entity.id,
        accountId: account.id,
        period: normalized.period,
        periodEnd: normalized.periodEnd,
        fiscalYear: normalized.fiscalYear,
        fiscalPeriod: normalized.fiscalPeriod,
        debit: String(normalized.debit),
        credit: String(normalized.credit),
        balance: String(normalized.balance),
        source,
      }).onConflictDoUpdate({
        target: [trialBalance.tenantId, trialBalance.entityId, trialBalance.accountId, trialBalance.period, trialBalance.source],
        set: {
          debit: String(normalized.debit),
          credit: String(normalized.credit),
          balance: String(normalized.balance),
        },
      });

      importedRows++;
      importedAccountIds.add(account.id);
    }

    const jobId = await addAutoMappingJob(user.tenantId);

    return c.json({
      importedRows,
      accounts: importedAccountIds.size,
      source,
      autoMappingJobId: jobId,
      message: 'Trial balance imported. Auto-mapping job enqueued.',
    }, 201);
  });
});

function normalizeRow(row: ImportRow, lineNumber: number) {
  const entityName = getField(row, ['entityName', 'entity', 'subsidiary', 'legalEntity']) || 'Imported Entity';
  const entityExternalId = slugify(getField(row, ['entityExternalId', 'entityId', 'entity']) || entityName);
  const accountName = getRequiredField(row, ['accountName', 'account', 'name'], lineNumber);
  const accountNumber = getField(row, ['accountNumber', 'accountNo', 'number']) || undefined;
  const accountExternalId = getField(row, ['accountExternalId', 'accountId']) || `${accountNumber ?? slugify(accountName)}`;
  const accountType = normalizeAccountType(getRequiredField(row, ['accountType', 'type'], lineNumber), lineNumber);
  const period = normalizeDate(getRequiredField(row, ['period', 'periodStart', 'date'], lineNumber), lineNumber);
  const periodEnd = normalizeDate(getField(row, ['periodEnd', 'endPeriod']) || period, lineNumber);
  const debit = parseAmount(getField(row, ['debit', 'debits']) || '0', lineNumber);
  const credit = parseAmount(getField(row, ['credit', 'credits']) || '0', lineNumber);
  const balanceField = getField(row, ['balance', 'endingBalance', 'net']);
  const balance = balanceField ? parseAmount(balanceField, lineNumber) : debit - credit;
  const periodDate = new Date(`${period}T00:00:00.000Z`);

  return {
    entityName,
    entityExternalId,
    accountName,
    accountNumber,
    accountExternalId,
    accountType,
    detailType: getField(row, ['detailType', 'accountDetailType']) || accountType,
    period,
    periodEnd,
    fiscalYear: periodDate.getUTCFullYear(),
    fiscalPeriod: periodDate.getUTCMonth() + 1,
    debit,
    credit,
    balance,
    currency: (getField(row, ['currency']) || 'USD').toUpperCase(),
    taxJurisdiction: getField(row, ['taxJurisdiction', 'jurisdiction']) || 'US-Federal',
  };
}

function parseCsv(csv: string): ImportRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(header => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function getRequiredField(row: ImportRow, keys: string[], lineNumber: number) {
  const value = getField(row, keys);
  if (!value) throw new BadRequestError(`Missing required field "${keys[0]}" on CSV line ${lineNumber}`);
  return value;
}

function getField(row: ImportRow, keys: string[]) {
  const lowerCaseEntries = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lowerCaseEntries.get(key.toLowerCase());
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function normalizeAccountType(value: string, lineNumber: number) {
  const normalized = value.trim().toLowerCase();
  const typeMap: Record<string, string> = {
    income: 'Income',
    revenue: 'Income',
    sales: 'Income',
    service: 'Income',
    otherincome: 'Income',
    expense: 'Expense',
    cogs: 'Expense',
    costofgoodsold: 'Expense',
    otherexpense: 'Expense',
    operatingexpense: 'Expense',
    sga: 'Expense',
    sgana: 'Expense',
    asset: 'Asset',
    liability: 'Liability',
    equity: 'Equity',
  };
  const accountType = typeMap[normalized];
  if (!accountType) throw new BadRequestError(`Invalid accountType "${value}" on CSV line ${lineNumber}`);
  return accountType;
}

function normalizeDate(value: string, lineNumber: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`Invalid date "${value}" on CSV line ${lineNumber}. Use YYYY-MM-DD.`);
  }
  return value;
}

function parseAmount(value: string, lineNumber: number) {
  const normalized = value.replace(/[$,\s]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new BadRequestError(`Invalid amount "${value}" on CSV line ${lineNumber}`);
  return amount;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported';
}

// ── Auto-mapping status and summary ──
importRoutes.get('/auto-mapping/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await autoMappingQueue.getJob(jobId);

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

importRoutes.get('/auto-mapping/summary', async (c) => {
  const user = c.get('user');
  return withTenantContext(user.tenantId, async (tx) => {
    const allMappings = await tx.select().from(taxMappings)
      .where(and(
        eq(taxMappings.tenantId, user.tenantId),
        eq(taxMappings.suggestedByAi, true),
      ))
      .orderBy(desc(taxMappings.createdAt));

    const drafts = allMappings.filter((m: typeof taxMappings.$inferSelect) => m.status === 'draft');
    const active = allMappings.filter((m: typeof taxMappings.$inferSelect) => m.status === 'active');
    const totalAccounts = await tx.select({ count: accounts.id }).from(accounts)
      .where(eq(accounts.tenantId, user.tenantId));

    const openItems = await tx.select({ count: reviewItems.id }).from(reviewItems)
      .where(and(
        eq(reviewItems.tenantId, user.tenantId),
        eq(reviewItems.status, 'open'),
      ));

    const totalAccountCount = Number(totalAccounts[0]?.count ?? 0);
    const openItemCount = Number(openItems[0]?.count ?? 0);

    return c.json({
      totalAccounts: totalAccountCount,
      draftMappings: drafts.length,
      activeMappings: active.length,
      openReviewItems: openItemCount,
      message: openItemCount > 0
        ? `Draft mapping ready; ${active.length + drafts.length} of ${totalAccountCount} accounts matched approved precedent; ${openItemCount} items require review.`
        : `All ${totalAccountCount} accounts mapped successfully; no items require review.`,
    });
  });
});

// ── Export trial balance as CSV for inspection ──
importRoutes.get('/trial-balance/export', async (c) => {
  const user = c.get('user');

  return withTenantContext(user.tenantId, async (tx) => {
    const tbRows = await tx.select().from(trialBalance)
      .where(eq(trialBalance.tenantId, user.tenantId))
      .orderBy(trialBalance.period, trialBalance.accountId);

    const entityIds = [...new Set(tbRows.map(r => r.entityId))];
    const accountIds = [...new Set(tbRows.map(r => r.accountId))];

    const entityRows = entityIds.length > 0
      ? await tx.select().from(entities).where(and(eq(entities.tenantId, user.tenantId), inArray(entities.id, entityIds)))
      : [];
    const entityMap = new Map(entityRows.map(e => [e.id, e]));

    const accountRows = accountIds.length > 0
      ? await tx.select().from(accounts).where(and(eq(accounts.tenantId, user.tenantId), inArray(accounts.id, accountIds)))
      : [];
    const accountMap = new Map(accountRows.map(a => [a.id, a]));

    const headers = ['period', 'entity', 'entityName', 'accountNumber', 'accountName', 'accountType', 'debit', 'credit', 'balance'];
    const rows = tbRows.map(r => [
      r.period,
      entityMap.get(r.entityId)?.externalId ?? '',
      entityMap.get(r.entityId)?.name ?? '',
      accountMap.get(r.accountId)?.accountNumber ?? '',
      accountMap.get(r.accountId)?.name ?? '',
      accountMap.get(r.accountId)?.type ?? '',
      r.debit,
      r.credit,
      r.balance,
    ]);

    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="taxpro-trial-balance.csv"');
    return c.body([headers.join(','), ...rows.map(r => r.join(','))].join('\n'));
  });
});
