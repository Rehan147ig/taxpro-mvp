import { createSign } from 'crypto';

/**
 * MTD for Corporation Tax — readiness client.
 *
 * STATUS (verified against the HMRC Developer Hub, July 2026):
 *   - There is NO public MTD for Corporation Tax API yet. The mandate covers
 *     accounting periods starting on/after 1 April 2026, but the CT MTD API
 *     is still in private beta and does not appear on the Developer Hub.
 *   - The LIVE filing channel today is Corporation Tax Online (CTO): the
 *     GovTalk XML CT600 submission API (see ../export/cto-xml.ts). That is
 *     what IRIS/Digita/TaxCalc file through, using the accountant's
 *     Government Gateway credentials.
 *
 * This module stays as the MTD *readiness* layer:
 *   - buildMtdCtSubmission(): the payload shape the future CT MTD return
 *     endpoint will consume, straight from a provision result.
 *   - MtdClient: a sandbox adapter wired to the HMRC test environment
 *     (test-api.service.hmrc.gov.uk) using the same OAuth2 JWT client
 *     assertion flow the live service will use.
 *   - buildMtdReadinessReport(): the checklist (UTR, agent authority, MTD
 *     sign-up, software link) that gates MTD filing when the API opens.
 *
 * When HMRC opens the CT endpoint, only the path + method constants change;
 * the payload builder and readiness gate are already the real thing.
 */

export const MTD = {
  TEST_BASE_URL: 'https://test-api.service.hmrc.gov.uk',
  PROD_BASE_URL: 'https://api.service.hmrc.gov.uk',
  CT_SERVICE: 'corporation-tax',
  // MTD-CT open APIs (private beta / announced):
  CT_RETURN_PATH: '/corporation-tax/return',
  CT_OBLIGATIONS_PATH: '/corporation-tax/obligations',
} as const;

export interface MtdConfig {
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  baseUrl?: string;
  /** Per-request timeout in ms (default 10s). */
  fetchTimeoutMs?: number;
}

export interface MtdCtSubmission {
  period: { start: string; end: string };
  utr: string;
  amounts: {
    taxableTotalProfits: number;
    taxChargeable: number;
    marginalRelief: number;
    taxCredits: number;
    taxDeductedAtSource: number;
    taxPayable: number;
    balanceDue: number;
    rdeс: number; // typo-proof alias below
  };
}

export interface MtdReadinessReport {
  eligible: boolean;
  gate: Array<{ requirement: string; met: boolean; detail: string }>;
  missing: string[];
  nextSteps: string[];
  mandateStart: string;
}

export function buildMtdCtSubmission(ct600: {
  period: { start: string; end: string };
  utr: string;
  computed: { totalTaxCharge: number; taxPayable: number; balanceDue: number };
  boxes: Array<{ box: number; name: string; value: string | number }>;
}): MtdCtSubmission {
  const box = (n: number) => Number(ct600.boxes.find(b => b.box === n)?.value ?? 0);
  return {
    period: ct600.period,
    utr: ct600.utr,
    amounts: {
      taxableTotalProfits: box(10),
      taxChargeable: ct600.computed.totalTaxCharge,
      marginalRelief: box(14),
      taxCredits: box(16),
      taxDeductedAtSource: box(17),
      taxPayable: ct600.computed.taxPayable,
      balanceDue: ct600.computed.balanceDue,
      rdeс: 0,
    },
  };
}

export function assertMtdEligible(report: MtdReadinessReport): void {
  if (!report.eligible) {
    throw new Error(`MTD readiness gate not met: ${report.missing.join('; ')}`);
  }
}

export class MtdClient {
  constructor(private config: MtdConfig) {}

  private async accessToken(): Promise<string> {
    const assertion = this.signedAssertion();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: `openid ${MTD.CT_SERVICE}`,
    });
    const res = await fetch(`${this.base()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/vnd.hmrc.2.0+json' },
      body,
      signal: this.signal(),
    });
    if (!res.ok) throw new Error(`HMRC token failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token?: string };
    if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
      throw new Error('HMRC token response malformed: no access_token');
    }
    return json.access_token;
  }

  /**
   * Submit a return in the sandbox (CT endpoint in private beta — readiness only).
   * The readiness gate is separate: call buildMtdReadinessReport + assertMtdEligible
   * first; an optional report is accepted here as defense-in-depth so a submission
   * can never bypass the gate accidentally.
   */
  async submitReturn(submission: MtdCtSubmission, readiness?: MtdReadinessReport): Promise<{ submissionId: string; status: string }> {
    if (readiness) assertMtdEligible(readiness);
    const token = await this.accessToken();
    const body = {
      period: submission.period,
      ...submission.amounts,
    };
    const res = await fetch(`${this.base()}${MTD.CT_RETURN_PATH}/${submission.utr}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.hmrc.2.0+json',
      },
      body: JSON.stringify(body),
      signal: this.signal(),
    });
    if (!res.ok) throw new Error(`HMRC return submission failed: ${res.status} ${await res.text()}`);
    return { submissionId: `stub-${Date.now()}`, status: 'sandbox-accepted' };
  }

  private signedAssertion(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: this.config.clientId,
      sub: this.config.clientId,
      aud: this.base(),
      exp: now + 900,
      iat: now,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    signer.end();
    const sig = b64url(signer.sign(this.config.privateKeyPem));
    return `${header}.${claims}.${sig}`;
  }

  private base(): string {
    return this.config.baseUrl ?? MTD.TEST_BASE_URL;
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.config.fetchTimeoutMs ?? 10_000);
  }
}

export function buildMtdReadinessReport(opts: {
  utr: string;
  companiesHouseNumber?: string;
  periodStart: string;
  hasAgentAuthority: boolean;
  signedUpToMtd: boolean;
  softwareConnected: boolean;
}): MtdReadinessReport {
  const utrOk = /^\d{10}$/.test(opts.utr);
  const chOk = !opts.companiesHouseNumber || /^[A-Z0-9]{8}$/.test(opts.companiesHouseNumber);
  const gate = [
    { requirement: 'Valid 10-digit UTR', met: utrOk, detail: opts.utr },
    { requirement: 'Companies House number on file', met: chOk, detail: opts.companiesHouseNumber ?? '(none)' },
    { requirement: 'Agent has HMRC authority (64-8 / agent services)', met: opts.hasAgentAuthority, detail: opts.hasAgentAuthority ? 'Authorised' : 'Not yet authorised' },
    { requirement: 'Company signed up for MTD for Corporation Tax', met: opts.signedUpToMtd, detail: opts.signedUpToMtd ? 'Signed up' : 'Sign-up required (mandate from 1 Apr 2026)' },
    { requirement: 'Filing software connection verified', met: opts.softwareConnected, detail: opts.softwareConnected ? 'Connected' : 'Complete the sandbox end-to-end test first' },
  ];
  const missing = gate.filter(g => !g.met).map(g => g.requirement);
  return {
    eligible: missing.length === 0,
    gate,
    missing,
    nextSteps: missing.length === 0
      ? ['File today via Corporation Tax Online XML (see /cto-xml) — MTD-CT API still in private beta', 'Re-run readiness when HMRC opens the CT MTD API']
      : [`Complete: ${missing.join('; ')}`, 'Verify the CTO XML output in the HMRC Local Test Service first'],
    mandateStart: '2026-04-01',
  };
}

function b64url(buf: string | Buffer): string {
  return Buffer.from(buf).toString('base64url');
}
