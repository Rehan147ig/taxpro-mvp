import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildAuthUrl, exchangeCode, refreshTokens, listOrganisations,
  fetchTrialBalance, parseTrialBalanceRows, encryptToken, decryptToken,
} from './xero-client.js';
import type { XeroReportEnvelope } from './xero-client.js';

describe('buildAuthUrl', () => {
  it('produces a PKCE auth URL with S256 challenge and state', () => {
    const { url, codeVerifier, state } = buildAuthUrl({ clientId: 'cid', redirectUri: 'http://localhost:3000/cb' });
    expect(url.startsWith('https://login.xero.com/identity/connect/authorize?')).toBe(true);
    expect(url).toContain('response_type=code');
    expect(url).toContain('code_challenge=');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain(`state=${state}`);
    expect(codeVerifier.length).toBeGreaterThan(30);
    expect(state.length).toBe(32);
  });
});

describe('token endpoints', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('exchangeCode posts the right grant and parses tokens', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 }),
    });
    const tokens = await exchangeCode({ code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://cb', codeVerifier: 'v' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://identity.xero.com/connect/token');
    expect(init.body.get('grant_type')).toBe('authorization_code');
    expect(init.body.get('code_verifier')).toBe('v');
    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
  });

  it('refreshTokens posts refresh grant', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }) });
    const tokens = await refreshTokens({ refreshToken: 'rt', clientId: 'cid', clientSecret: 'sec' });
    const init = (fetch as any).mock.calls[0][1];
    expect(init.body.get('grant_type')).toBe('refresh_token');
    expect(tokens.expiresAt).toBeTruthy();
  });

  it('throws on non-ok token responses', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' });
    await expect(exchangeCode({ code: 'c', clientId: 'c', clientSecret: 's', redirectUri: 'u', codeVerifier: 'v' }))
      .rejects.toThrow(/400 invalid_grant/);
  });
});

describe('listOrganisations', () => {
  it('maps the connections payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tenantId: 't1', tenantName: 'Acme Ltd' }],
    }));
    const orgs = await listOrganisations('at');
    expect(orgs).toEqual([{ tenantId: 't1', name: 'Acme Ltd' }]);
    vi.unstubAllGlobals();
  });
});

describe('fetchTrialBalance', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const envelope = {
    Reports: [{
      ReportID: 'TrialBalance',
      ReportTitles: ['Trial Balance', 'Acme Ltd', '01 April 2025 to 31 March 2026'],
      Rows: [
        { RowType: 'Header', Cells: [{ Value: 'Account' }, { Value: 'Debit' }, { Value: 'Credit' }] },
        { RowType: 'Row', Cells: [{ Value: '4000' }, { Value: 'Sales' }, { Value: '125,000.00' }, { Value: '' }] },
        { RowType: 'Row', Cells: [{ Value: '6000' }, { Value: 'Salaries' }, { Value: '' }, { Value: '45,200.00' }] },
        { RowType: 'Row', Cells: [{ Value: '' }, { Value: '' }, { Value: '' }, { Value: '' }] },
        { RowType: 'SummaryRow', Cells: [{ Value: '' }, { Value: 'Total' }, { Value: '170,200.00' }, { Value: '170,200.00' }] },
      ],
    }],
  };

  it('sends xero-tenant-id and parses debit/credit into signed balances', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => envelope });
    const result = await fetchTrialBalance({ accessToken: 'at', xeroTenantId: 'xt', periodStart: '2025-04-01', periodEnd: '2026-03-31' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url.href).toContain('/api.xro/2.0/Reports/TrialBalance');
    expect(url.searchParams.get('fromDate')).toBe('2025-04-01');
    expect(init.headers['xero-tenant-id']).toBe('xt');
    expect(init.headers.Authorization).toBe('Bearer at');
    expect(result.lines).toEqual([
      { accountCode: '4000', accountName: 'Sales', balance: 125000 },
      { accountCode: '6000', accountName: 'Salaries', balance: -45200 },
    ]);
  });

  it('throws on report failure', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });
    await expect(fetchTrialBalance({ accessToken: 'at', xeroTenantId: 'xt', periodStart: '2025-04-01', periodEnd: '2026-03-31' }))
      .rejects.toThrow(/401/);
  });
});

describe('parseTrialBalanceRows', () => {
  it('handles sections and empty envelopes', () => {
    const withSections: XeroReportEnvelope = {
      Reports: [{
        Rows: [
          { RowType: 'Section', Rows: [
            { RowType: 'Row', Cells: [{ Value: 'A1' }, { Value: 'Bank' }, { Value: '10.50' }, { Value: '' }] },
          ] },
          { RowType: 'Row', Cells: [{ Value: 'A2' }, { Value: 'Loan' }, { Value: '' }, { Value: '5.25' }] },
        ],
      }],
    };
    expect(parseTrialBalanceRows(withSections)).toEqual([
      { accountCode: 'A1', accountName: 'Bank', balance: 10.5 },
      { accountCode: 'A2', accountName: 'Loan', balance: -5.25 },
    ]);
    expect(parseTrialBalanceRows({})).toEqual([]);
    expect(parseTrialBalanceRows({ Reports: [] })).toEqual([]);
  });
});

describe('token obfuscation', () => {
  it('round-trips tokens through encrypt/decrypt', () => {
    const enc = encryptToken('super-secret-token');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('super-secret-token');
    expect(decryptToken(enc)).toBe('super-secret-token');
  });

  it('rejects tampered payloads', () => {
    const enc = encryptToken('tok');
    expect(() => decryptToken(`${enc.slice(0, -2)}xx`)).toThrow();
  });
});
