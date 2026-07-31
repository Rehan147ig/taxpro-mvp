import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildQboAuthUrl, exchangeQboCode, refreshQboTokens, fetchQboTrialBalance,
  parseQboReport, encryptToken, decryptToken, QBO_BASE_URLS,
} from './quickbooks-client.js';
import type { QboReportEnvelope } from './quickbooks-client.js';

describe('buildQboAuthUrl', () => {
  it('builds the appcenter OAuth2 URL with scope and state', () => {
    const { url, state } = buildQboAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/cb' });
    expect(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')).toBe(true);
    expect(url).toContain('scope=com.intuit.quickbooks.accounting');
    expect(url).toContain(`state=${state}`);
  });
});

describe('token endpoints', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('exchangeQboCode posts authorization_code grant (no PKCE)', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) });
    const tokens = await exchangeQboCode({ code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://cb' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
    expect(init.body.get('grant_type')).toBe('authorization_code');
    expect(init.body.has('code_verifier')).toBe(false);
    expect(tokens.accessToken).toBe('at');
  });

  it('refreshQboTokens posts refresh grant', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }) });
    const tokens = await refreshQboTokens({ refreshToken: 'rt', clientId: 'cid', clientSecret: 'sec' });
    const init = (fetch as any).mock.calls[0][1];
    expect(init.body.get('grant_type')).toBe('refresh_token');
    expect(tokens.expiresAt).toBeTruthy();
  });
});

describe('fetchQboTrialBalance', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const envelope: QboReportEnvelope = {
    Header: { StartDate: '2025-01-01', EndDate: '2025-12-31' },
    Columns: {
      Column: [
        { ColTitle: 'Account', ColType: 'Account' },
        { ColTitle: 'Opening Balance', ColType: 'Money' },
        { ColTitle: 'Debit', ColType: 'Money' },
        { ColTitle: 'Credit', ColType: 'Money' },
        { ColTitle: 'Closing Balance', ColType: 'Money' },
      ],
    },
    Rows: {
      Row: [
        { type: 'Data', ColData: [{ value: 'Sales' }, { value: '0' }, { value: '250,000.00' }, { value: '' }, { value: '250,000.00' }] },
        { type: 'Data', ColData: [{ value: 'Salaries' }, { value: '0' }, { value: '' }, { value: '120,000.00' }, { value: '120,000.00' }] },
        { type: 'Total', ColData: [{ value: 'Total' }, { value: '' }, { value: '370,000.00' }, { value: '370,000.00' }, { value: '' }] },
      ],
    },
  };

  it('hits the sandbox base with realmId and parses Debit/Credit activity', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => envelope });
    const result = await fetchQboTrialBalance({
      accessToken: 'at', realmId: '123', periodStart: '2025-01-01', periodEnd: '2025-12-31',
      baseUrl: QBO_BASE_URLS.sandbox,
    });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url.href).toContain('/v3/company/123/reports/TrialBalance');
    expect(url.searchParams.get('start_date')).toBe('2025-01-01');
    expect(url.searchParams.get('end_date')).toBe('2025-12-31');
    expect(init.headers.Authorization).toBe('Bearer at');
    expect(result.lines).toEqual([
      { accountName: 'Sales', balance: 250000 },
      { accountName: 'Salaries', balance: -120000 },
    ]);
  });

  it('throws on failure', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    await expect(fetchQboTrialBalance({ accessToken: 'at', realmId: '1', periodStart: 'a', periodEnd: 'b' }))
      .rejects.toThrow(/401/);
  });
});

describe('parseQboReport', () => {
  it('handles parenthesised negatives and missing credit column', () => {
    const neg: QboReportEnvelope = {
      Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Debit' }, { ColTitle: 'Credit' }] },
      Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Loan' }, { value: '' }, { value: '(50.00)' }] }] },
    };
    // (50.00) in the credit column is a negative credit = net debit of 50
    expect(parseQboReport(neg)).toEqual([{ accountName: 'Loan', balance: 50 }]);
    const negDebit: QboReportEnvelope = {
      Columns: { Column: [{ ColTitle: 'Account' }, { ColTitle: 'Debit' }, { ColTitle: 'Credit' }] },
      Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Contra' }, { value: '(25.00)' }, { value: '' }] }] },
    };
    expect(parseQboReport(negDebit)).toEqual([{ accountName: 'Contra', balance: -25 }]);
    expect(parseQboReport({ Columns: { Column: [{ ColTitle: 'Account' }] } })).toEqual([]);
    expect(parseQboReport({})).toEqual([]);
  });
});

describe('token obfuscation', () => {
  it('round-trips through the shared encrypt helpers', () => {
    const enc = encryptToken('qbo-secret');
    expect(decryptToken(enc)).toBe('qbo-secret');
  });
});
