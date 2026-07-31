import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { withTenantContext } from '../../config/db.js';
import { accounts } from '../../db/schema/accounts.js';
import { entities } from '../../db/schema/entities.js';
import { trialBalance } from '../../db/schema/trial-balance.js';
import { authMiddleware } from '../../lib/middleware/auth.js';
import { BadRequestError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { addAutoMappingJob } from '../import/auto-mapping/auto-mapping.queue.js';

export const uploadRoutes = new Hono();

const INTERFAZE_PARSE_URL = process.env.INTERFAZE_ENDPOINT || 'https://api.interfaze.ai/v1';
const INTERFAZE_API_KEY = process.env.INTERFAZE_API_KEY;
const INTERFAZE_MODEL = process.env.INTERFAZE_MODEL || 'interfaze-beta';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};

/** Prompt the vision model to emit trial balance rows as strict JSON. */
const TRIAL_BALANCE_PROMPT = [
  'You are extracting a trial balance from an accounting document.',
  'Extract every row that contains an account (skip header rows, subtotals and totals unless they are actual accounts).',
  'Return ONLY a JSON array of objects with these keys:',
  'accountNumber, accountName, debit, credit, balance (debit/credit/balance as numbers, credits and negative balances negative).',
  'Optionally include entityName, entityExternalId, accountType, currency, period and periodEnd when present in the document.',
  'Do not wrap the JSON in markdown or add any commentary.',
].join(' ');

function isInterfazeConfigured(): boolean {
  return !!INTERFAZE_API_KEY && process.env.AI_PROVIDER === 'interfaze';
}

const uploadSchema = z.object({
  jurisdiction: z.string().optional(),
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entityName: z.string().optional(),
});

uploadRoutes.use('*', authMiddleware);

uploadRoutes.post('/trial-balance', zValidator('form', uploadSchema), async (c) => {
  const user = c.get('user');
  const contentType = c.req.header('Content-Type') || '';

  if (!contentType.includes('multipart/form-data')) {
    throw new BadRequestError('Expected multipart/form-data upload');
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    throw new BadRequestError('No file uploaded. Use field name "file".');
  }

  const fileName = file.name.toLowerCase();
  const supportedTypes = ['.pdf', '.xlsx', '.xls', '.csv'];
  const isSupported = supportedTypes.some(ext => fileName.endsWith(ext));

  if (!isSupported) {
    throw new BadRequestError(`Unsupported file type: ${fileName}. Supported: ${supportedTypes.join(', ')}`);
  }

  if (!isInterfazeConfigured()) {
    throw new BadRequestError(
      'Interfaze is not configured. Set AI_PROVIDER=interfaze and INTERFAZE_API_KEY in your environment, ' +
      'or use the CSV import endpoint (POST /api/import/trial-balance) for text-based trial balance ingestion.'
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB. Maximum upload size is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`
    );
  }

  const base64File = buffer.toString('base64');
  const mime = MIME_BY_EXT[fileName.slice(fileName.lastIndexOf('.'))] ?? 'application/octet-stream';

  const parseResponse = await fetch(`${INTERFAZE_PARSE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${INTERFAZE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: INTERFAZE_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: TRIAL_BALANCE_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64File}` } },
          ],
        },
      ],
    }),
  });

  if (!parseResponse.ok) {
    const errorBody = await parseResponse.text().catch(() => 'Unknown error');
    logger.error({ status: parseResponse.status, body: errorBody }, '[Interfaze] Parse request failed');
    throw new BadRequestError(`Interfaze parsing failed: HTTP ${parseResponse.status}`);
  }

  const parsed = await parseResponse.json() as any;
  const content = parsed?.choices?.[0]?.message?.content;
  const ocrText = parsed?.precontext?.[0]?.result?.extracted_text;

  let rows = tryParseRows(content);
  if (rows.length === 0 && Array.isArray(parsed?.object)) {
    rows = parsed.object;
  }

  if (rows.length === 0) {
    logger.warn({ fileName: file.name }, '[Upload] Interfaze returned no extractable rows');
    return c.json({
      source: 'interfaze-multimodal',
      fileName: file.name,
      parsed: { ocrText },
      importedRows: 0,
      message: 'Interfaze parsed the document but no trial balance rows were detected. ' +
        'Check the raw parsed output and feed it to the parser agent for structured extraction.',
    });
  }

  const jurisdiction = (c.req.valid('form').jurisdiction ?? 'US-Federal');
  const defaultPeriod = c.req.valid('form').period ?? '2026-01-01';
  const entityName = c.req.valid('form').entityName ?? 'Uploaded Entity';

  return withTenantContext(user.tenantId, async (tx) => {
    let importedRows = 0;
    const importedAccountIds = new Set<string>();
    let entityId: string | null = null;

    for (const [index, row] of rows.entries()) {
      const normalized = normalizeRow(row, index + 2, defaultPeriod);

      const [entity] = await tx.insert(entities).values({
        tenantId: user.tenantId,
        externalId: normalized.entityExternalId,
        name: normalized.entityName,
        type: 'domestic',
        currency: normalized.currency,
        isConsolidated: true,
        taxJurisdiction: jurisdiction,
      }).onConflictDoUpdate({
        target: [entities.tenantId, entities.externalId],
        set: {
          name: normalized.entityName,
          currency: normalized.currency,
          updatedAt: new Date(),
        },
      }).returning();
      entityId = entity.id;

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
        source: 'interfaze',
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

    let autoMappingJobId: string | undefined;
    try {
      autoMappingJobId = await addAutoMappingJob(user.tenantId);
    } catch (err: any) {
      logger.warn({ err }, '[Upload] Auto-mapping job enqueue failed (Redis down?)');
    }

    logger.info({ fileName: file.name, rows: importedRows, provider: 'interfaze' }, '[Upload] Trial balance imported via Interfaze multimodal');

    return c.json({
      source: 'interfaze-multimodal',
      fileName: file.name,
      importedRows,
      accounts: importedAccountIds.size,
      entityId,
      autoMappingJobId,
      nextStep: 'Run AI mapping, then "Provision" to calculate tax.',
    }, 201);
  });
});

/** Parse the model's message content into rows. Tolerates bare JSON arrays,
 *  JSON wrapped in markdown fences, and content as an array of text blocks. */
function tryParseRows(content: any): any[] {
  if (content === null || content === undefined) return [];
  let raw = content;
  if (Array.isArray(raw)) {
    raw = raw
      .map(block => (typeof block === 'string' ? block : block?.text ?? ''))
      .join('');
  }
  if (typeof raw !== 'string') return [];
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
  try {
    return extractRows(JSON.parse(jsonMatch[1].trim()));
  } catch {
    return [];
  }
}

/** Extract trial-balance-like rows from the raw model response.
 *  Tolerates common shapes: bare array, {rows}, {data}, {items}, {trialBalance}, {accounts}. */
function extractRows(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const candidates = [
    parsed.rows,
    parsed.data,
    parsed.items,
    parsed.trialBalance,
    parsed.trial_balance,
    parsed.accounts,
    parsed.lines,
    Array.isArray(parsed) ? parsed : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

interface NormalizedRow {
  entityName: string;
  entityExternalId: string;
  accountName: string;
  accountNumber: string;
  accountExternalId: string;
  accountType: string;
  detailType: string;
  period: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalPeriod: number;
  debit: number;
  credit: number;
  balance: number;
  currency: string;
}

function pick(value: any, keys: string[]): any {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return undefined;
  const lower = new Map(Object.entries(value).map(([k, v]) => [String(k).toLowerCase().replace(/[\s_-]/g, ''), v]));
  for (const key of keys) {
    const v = lower.get(key);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normalizeRow(row: any, lineNumber: number, defaultPeriod: string): NormalizedRow {
  const accountName = String(pick(row, ['accountname', 'account', 'name', 'label', 'accounttitle']) ?? `Account ${lineNumber}`);
  const accountNumber = String(pick(row, ['accountnumber', 'accountno', 'number', 'code', 'acctno']) ?? '');
  const accountTypeRaw = String(pick(row, ['accounttype', 'type', 'category', 'section']) ?? 'Expense');
  const balanceRaw = pick(row, ['balance', 'net', 'endingbalance', 'amount', 'netbalance']);
  const debitRaw = pick(row, ['debit', 'debits', 'debitamount']);
  const creditRaw = pick(row, ['credit', 'credits', 'creditamount']);
  const period = String(pick(row, ['period', 'periodstart', 'date', 'fiscalperiod']) ?? defaultPeriod);
  const periodEnd = String(pick(row, ['periodend', 'endperiod']) ?? period);

  const debit = parseAmount(debitRaw, lineNumber);
  const credit = parseAmount(creditRaw, lineNumber);
  const balance = balanceRaw !== undefined && balanceRaw !== null && balanceRaw !== ''
    ? parseAmount(balanceRaw, lineNumber)
    : debit - credit;

  const periodDate = new Date(`${period}T00:00:00.000Z`);

  return {
    entityName: String(pick(row, ['entityname', 'entity', 'legalentity']) ?? 'Uploaded Entity'),
    entityExternalId: slugify(String(pick(row, ['entityexternalid', 'entityid', 'entity']) ?? 'Uploaded Entity')),
    accountName,
    accountNumber,
    accountExternalId: String(pick(row, ['accountexternalid', 'accountid']) ?? `${accountNumber || slugify(accountName)}`),
    accountType: normalizeAccountType(accountTypeRaw, lineNumber),
    detailType: String(pick(row, ['detailtype', 'accountdetailtype']) ?? normalizeAccountType(accountTypeRaw, lineNumber)),
    period,
    periodEnd,
    fiscalYear: periodDate.getUTCFullYear(),
    fiscalPeriod: periodDate.getUTCMonth() + 1,
    debit,
    credit,
    balance,
    currency: String(pick(row, ['currency']) ?? 'GBP').toUpperCase(),
  };
}

function parseAmount(value: any, lineNumber: number) {
  if (value === undefined || value === null || value === '') return 0;
  const normalized = String(value).replace(/[£$€,\s]/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new BadRequestError(`Invalid amount "${value}" on line ${lineNumber}`);
  return amount;
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
  if (!accountType) throw new BadRequestError(`Invalid accountType "${value}" on line ${lineNumber}`);
  return accountType;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported';
}
