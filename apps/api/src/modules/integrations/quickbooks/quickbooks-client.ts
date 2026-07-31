import { encryptToken, decryptToken } from '../xero/xero-client.js';

/**
 * QuickBooks Online OAuth2 client + Trial Balance report fetch.
 *
 * QBO differs from Xero in two ways worth preserving here:
 *  - No PKCE — plain auth-code flow; the client_secret does the work.
 *  - The TrialBalance report is an HTML-ish column grid, not a node tree:
 *      GET {base}/v3/company/{realmId}/reports/TrialBalance?start_date=&end_date=
 *    with Columns[{ColTitle, ColType}] and Rows[].Row[].ColData[].value.
 *    The report carries Opening Balance / Debit / Credit / Closing Balance
 *    columns; we take the period activity (Debit − Credit) as the net
 *    balance for provisioning.
 *
 * Base URL switches sandbox ↔ production (developer.api.intuit.com discovery).
 */

export const QBO_BASE_URLS = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
} as const;

export interface QboTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface QboTbLine {
  accountName: string;
  balance: number; // net period activity, debit positive
}

export interface QboFetchResult {
  periodStart: string;
  periodEnd: string;
  lines: QboTbLine[];
}

export function buildQboAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
}): { url: string; state: string } {
  const state = cryptoRandomState();
  const scopes = opts.scopes ?? ['com.intuit.quickbooks.accounting', 'com.intuit.quickbooks.payment', 'openid', 'profile', 'email', 'phone', 'address'];
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    scope: scopes.join(' '),
    redirect_uri: opts.redirectUri,
    state,
  });
  return { url: `https://appcenter.intuit.com/connect/oauth2?${params}`, state };
}

export async function exchangeQboCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<QboTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`QBO token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; realmId?: string };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function refreshQboTokens(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<QboTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function fetchQboTrialBalance(opts: {
  accessToken: string;
  realmId: string;
  periodStart: string;
  periodEnd: string;
  baseUrl?: string;
}): Promise<QboFetchResult> {
  const base = opts.baseUrl ?? QBO_BASE_URLS.production;
  const url = new URL(`/v3/company/${opts.realmId}/reports/TrialBalance`, base);
  url.searchParams.set('start_date', opts.periodStart);
  url.searchParams.set('end_date', opts.periodEnd);
  url.searchParams.set('minorversion', '70');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QBO TrialBalance failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as QboReportEnvelope;
  return { periodStart: opts.periodStart, periodEnd: opts.periodEnd, lines: parseQboReport(json) };
}

// ── Parsing (pure) ──

export interface QboReportEnvelope {
  Header?: { StartDate?: string; EndDate?: string };
  Columns?: { Column?: Array<{ ColTitle?: string; ColType?: string }> };
  Rows?: { Row?: QboRow[] };
}

export interface QboRow {
  type?: string;
  ColData?: Array<{ value?: string; id?: string }>;
  Summary?: { ColData?: Array<{ value?: string }> };
}

export function parseQboReport(envelope: QboReportEnvelope): QboTbLine[] {
  const columns = envelope.Columns?.Column ?? [];
  const debitIdx = columns.findIndex(c => (c.ColTitle ?? '').toLowerCase() === 'debit');
  const creditIdx = columns.findIndex(c => (c.ColTitle ?? '').toLowerCase() === 'credit');
  if (debitIdx === -1 || creditIdx === -1) return [];

  const rows = envelope.Rows?.Row ?? [];
  const lines: QboTbLine[] = [];
  for (const row of rows) {
    if ((row.type ?? '').toLowerCase() !== 'data') continue;
    const cells = row.ColData ?? [];
    if (cells.length === 0) continue;
    const name = cells[0]?.value ?? '';
    if (!name || name.toLowerCase() === 'total') continue;
    const debit = parseQboValue(cells[debitIdx]?.value);
    const credit = parseQboValue(cells[creditIdx]?.value);
    lines.push({ accountName: name, balance: round2(debit - credit) });
  }
  return lines;
}

function parseQboValue(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/[£$€,]/g, '').trim();
  if (!cleaned) return 0;
  let negative = false;
  let numeric = cleaned;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    numeric = cleaned.slice(1, -1);
  } else if (/^-/.test(cleaned)) {
    negative = true;
    numeric = cleaned.replace(/^-/, '');
  }
  const n = Number(numeric);
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : Math.abs(n);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function cryptoRandomState(): string {
  const bytes = new Uint8Array(16);
  (globalThis as any).crypto?.getRandomValues?.(bytes);
  if ((globalThis as any).crypto?.getRandomValues) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export { encryptToken, decryptToken };
