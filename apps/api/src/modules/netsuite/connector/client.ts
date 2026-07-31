import { buildAuthHeader } from './auth.js';

/**
 * NetSuite REST API client.
 *
 * Handles OAuth 1.0 signing, retries, rate limiting, and JSON parsing.
 * Covers the three main endpoints needed for tax provision:
 *   - Subsidiaries (legal entities)
 *   - Chart of Accounts
 *   - Trial Balance (via SuiteQL)
 */

export interface NetSuiteConfig {
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  realm: string;
  baseUrl: string;
}

interface ApiOptions {
  method?: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

// NetSuite REST API base path
const REST_BASE = '/app/site/hosting/restlet.nl';

export class NetSuiteClient {
  private config: NetSuiteConfig;

  constructor(config: NetSuiteConfig) {
    this.config = config;
  }

  /**
   * Make an authenticated request to the NetSuite REST API.
   * Automatically signs with OAuth 1.0 and retries on rate limits.
   */
  async request<T>(options: ApiOptions): Promise<T> {
    const url = `${this.config.baseUrl}${options.path}`;
    const queryString = options.query
      ? '?' + new URLSearchParams(options.query).toString()
      : '';

    const fullUrl = url + queryString;

    const authHeader = buildAuthHeader({
      consumerKey: this.config.consumerKey,
      consumerSecret: this.config.consumerSecret,
      tokenId: this.config.tokenId,
      tokenSecret: this.config.tokenSecret,
      realm: this.config.realm,
      method: options.method || 'GET',
      url: fullUrl,
    });

    const response = await fetch(fullUrl, {
      method: options.method || 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) {
        // Rate limited — retry after Retry-After header
        const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.request<T>(options);
      }
      throw new Error(`NetSuite API error ${response.status}: ${text.slice(0, 500)}`);
    }

    return response.json();
  }

  // ── High-level API methods ──

  /**
   * Get all subsidiaries (legal entities).
   * /record/v1/subsidiary
   */
  async getSubsidiaries(): Promise<NetSuiteRecord[]> {
    try {
      const result = await this.request<{ items: NetSuiteRecord[] }>({
        path: `${REST_BASE}?script=customscript_subsidiaries&deploy=1`,
        query: { limit: '1000' },
      });
      return result.items || [];
    } catch {
      // Fallback: use REST record API
      const result = await this.request<{ items: NetSuiteRecord[] }>({
        path: '/services/rest/record/v1/subsidiary',
        query: { limit: '1000' },
      });
      return result.items || [];
    }
  }

  /**
   * Get chart of accounts.
   * /record/v1/account
   */
  async getChartOfAccounts(): Promise<NetSuiteAccount[]> {
    const result = await this.request<{ items: NetSuiteAccount[] }>({
      path: '/services/rest/record/v1/account',
      query: { limit: '1000' },
    });
    return result.items || [];
  }

  /**
   * Execute a SuiteQL query to get trial balance data.
   * SuiteQL is NetSuite's SQL-like query language.
   *
   * Query example:
   *   SELECT BUILTIN.DF(account), account, SUM(debit) as debit, SUM(credit) as credit
   *   FROM transaction
   *   WHERE trandate BETWEEN '2024-01-01' AND '2024-12-31'
   *     AND subsidiary = '1'
   *   GROUP BY account
   */
  async querySuiteQL<T = any>(query: string): Promise<SuiteQLResult<T>> {
    return this.request<SuiteQLResult<T>>({
      method: 'POST',
      path: '/services/rest/query/v1/suiteql',
      body: { q: query },
    });
  }

  /**
   * Get trial balance data for a given period and subsidiary.
   * Returns balance per account.
   */
  async getTrialBalance(
    startDate: string,
    endDate: string,
    subsidiaryId?: string,
  ): Promise<TrialBalanceRow[]> {
    let where = `trandate BETWEEN '${startDate}' AND '${endDate}'`;
    if (subsidiaryId) where += ` AND subsidiary = '${subsidiaryId}'`;

    const query = `
      SELECT
        BUILTIN.DF(account) as account_name,
        account as account_id,
        BUILTIN.DF(subsidiary) as subsidiary_name,
        subsidiary as subsidiary_id,
        SUM(debit) as debit,
        SUM(credit) as credit,
        SUM(debit - credit) as balance
      FROM transaction
      WHERE ${where}
      GROUP BY account, subsidiary
      ORDER BY account
    `;

    const result = await this.querySuiteQL<TrialBalanceRow>(query);
    return result.items || [];
  }

  /**
   * Post a journal entry to NetSuite via the REST record API.
   * /record/v1/journalEntry
   *
   * Lines use NetSuite internal account ids; debit and credit are numeric amounts.
   * The posted entry must balance (debits === credits).
   */
  async postJournalEntry(input: {
    subsidiaryId: string;
    trandate: string;
    memo: string;
    lines: { accountId: string; debit: number; credit: number; memo?: string }[];
  }): Promise<{ id: string }> {
    const totalDebit = input.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = input.lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 1e-6) {
      throw new Error(
        `Journal entry does not balance: debits ${totalDebit} vs credits ${totalCredit}`,
      );
    }

    const result = await this.request<{ id: string }>({
      method: 'POST',
      path: '/services/rest/record/v1/journalEntry',
      body: {
        subsidiary: { id: input.subsidiaryId },
        trandate: input.trandate,
        memo: input.memo,
        line: input.lines.map((line) => ({
          account: { id: line.accountId },
          debit: line.debit || 0,
          credit: line.credit || 0,
          memo: line.memo,
        })),
      },
    });

    return { id: result.id };
  }
}

// ── Types ──

export interface NetSuiteRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface NetSuiteAccount {
  id: string;
  name: string;
  acctnumber: string;
  accttype: string;
  description?: string;
  [key: string]: unknown;
}

export interface SuiteQLResult<T> {
  items: T[];
  hasMore: boolean;
  nextPageUrl?: string;
}

export interface TrialBalanceRow {
  account_name: string;
  account_id: string;
  subsidiary_name: string;
  subsidiary_id: string;
  debit: string;
  credit: string;
  balance: string;
}
