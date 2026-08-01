import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { assertMtdEligible, buildMtdCtSubmission, buildMtdReadinessReport, MtdClient, MTD } from './mtd-client.js';

const PRIVATE_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const CT600 = {
  period: { start: '2025-01-01', end: '2025-12-31' },
  utr: '1234567890',
  computed: { totalTaxCharge: 29375, taxPayable: 29375, balanceDue: 29375 },
  boxes: [
    { box: 10, name: 'Taxable total profits', value: 125000 },
    { box: 14, name: 'Marginal relief', value: 1875 },
    { box: 16, name: 'Tax credits', value: 0 },
    { box: 17, name: 'Tax deducted at source', value: 0 },
  ],
};

describe('buildMtdCtSubmission', () => {
  it('maps CT600 boxes into the MTD payload shape', () => {
    const s = buildMtdCtSubmission(CT600);
    expect(s.utr).toBe('1234567890');
    expect(s.amounts.taxableTotalProfits).toBe(125000);
    expect(s.amounts.marginalRelief).toBe(1875);
    expect(s.amounts.taxPayable).toBe(29375);
    expect(s.period).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });
});

describe('MtdClient (sandbox adapter)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const KEY_PEM = PRIVATE_PEM;

  it('gets a bearer token via JWT client assertion', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'hmrc-token' }) });
    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    const submission = buildMtdCtSubmission(CT600);
    await client.submitReturn(submission);

    const tokenCall = (fetch as any).mock.calls[0];
    expect(tokenCall[0]).toBe('https://test-api.service.hmrc.gov.uk/oauth/token');
    const body = tokenCall[1].body;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_assertion_type')).toContain('jwt-bearer');
    expect(body.get('client_assertion').split('.')).toHaveLength(3);

    const submitCall = (fetch as any).mock.calls[1];
    expect(submitCall[0].toString()).toContain(MTD.CT_RETURN_PATH);
    expect(submitCall[1].headers.Authorization).toBe('Bearer hmrc-token');
    expect(JSON.parse(submitCall[1].body).taxableTotalProfits).toBe(125000);
  });

  it('throws on token failure', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_client' });
    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    await expect(client.submitReturn(buildMtdCtSubmission(CT600))).rejects.toThrow(/400 invalid_client/);
  });

  it('throws on malformed token response (no access_token) without contacting the return endpoint', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ error: 'invalid_grant' }) });
    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    await expect(client.submitReturn(buildMtdCtSubmission(CT600))).rejects.toThrow(/malformed: no access_token/);
    expect((fetch as any).mock.calls).toHaveLength(1);
  });

  it('throws on HTTP failure of the return submission', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'hmrc-token' }) })
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'schema_violation' });
    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    await expect(client.submitReturn(buildMtdCtSubmission(CT600))).rejects.toThrow(/422 schema_violation/);
  });

  it('aborts hung requests via AbortSignal timeout', async () => {
    (fetch as any).mockImplementation((_url: string, opts: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM, fetchTimeoutMs: 5 });
    await expect(client.submitReturn(buildMtdCtSubmission(CT600))).rejects.toThrow(/aborted/i);
  });

  it('separates the readiness gate from submission: ineligible report blocks submission with no network call', async () => {
    const report = buildMtdReadinessReport({
      utr: '1234567890',
      periodStart: '2025-01-01',
      hasAgentAuthority: false,
      signedUpToMtd: false,
      softwareConnected: false,
    });
    expect(report.eligible).toBe(false);
    expect(report.missing.length).toBeGreaterThan(0);
    expect(() => assertMtdEligible(report)).toThrow(/MTD readiness gate not met/);

    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    await expect(client.submitReturn(buildMtdCtSubmission(CT600), report)).rejects.toThrow(/readiness gate/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the gate and submits when all readiness requirements are met', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'hmrc-token' }) });
    const report = buildMtdReadinessReport({
      utr: '1234567890',
      companiesHouseNumber: '00502851',
      periodStart: '2025-01-01',
      hasAgentAuthority: true,
      signedUpToMtd: true,
      softwareConnected: true,
    });
    expect(report.eligible).toBe(true);
    expect(() => assertMtdEligible(report)).not.toThrow();

    const client = new MtdClient({ clientId: 'cid', clientSecret: 'sec', privateKeyPem: KEY_PEM });
    await client.submitReturn(buildMtdCtSubmission(CT600), report);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('buildMtdReadinessReport', () => {
  it('flags missing prerequisites', () => {
    const r = buildMtdReadinessReport({ utr: '123', companiesHouseNumber: '00502851', periodStart: '2025-01-01', hasAgentAuthority: false, signedUpToMtd: false, softwareConnected: false });
    expect(r.eligible).toBe(false);
    expect(r.gate).toHaveLength(5);
    expect(r.missing.length).toBeGreaterThanOrEqual(4);
    expect(r.mandateStart).toBe('2026-04-01');
    expect(r.nextSteps.some(s => s.includes('64-8'))).toBe(true);
  });

  it('passes when everything is in place', () => {
    const r = buildMtdReadinessReport({ utr: '1234567890', companiesHouseNumber: '00502851', periodStart: '2025-01-01', hasAgentAuthority: true, signedUpToMtd: true, softwareConnected: true });
    expect(r.eligible).toBe(true);
    expect(r.missing).toEqual([]);
  });
});
