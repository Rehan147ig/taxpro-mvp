// ── ERP Adapters — interface shapes ONLY, no live API code ──
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.
//
// This file contains INTERFACES describing the assumed export shape of three
// ERPs (NetSuite, Xero, QuickBooks) plus pure normalizers to the package's
// internal `GlRowInput`. There is deliberately NO live API/connectivity code:
// connecting to any ERP, authenticating, or pulling data is out of scope.
//
// Every field shape below is ASSUMED from general public knowledge of these
// products' export formats. None of them has been verified against a real
// export file. See ASSUMPTIONS.md for the full list.

import { Decimal } from 'decimal.js';

/**
 * Canonical row accepted by the ELT pipeline. All fields except the amount
 * are strings/UUIDs; amounts are coerced to Decimal inside the pipeline.
 */
export interface GlRowInput {
  tenantId: string;
  accountId: string;
  /** Assumed ISO 'yyyy-mm-dd'. No timezone handling — a guessed gap. */
  transactionDate: string;
  sourceErp: string;
  amount: Decimal.Value;
  currency?: string;
  narration?: string | null;
  rawPayload?: unknown;
  taxTagOverrides?: string[];
}

/**
 * Assumed NetSuite general-ledger export row (CSV/Excel export shape).
 * Field names guessed; a real NetSuite GL export may name these differently
 * and may carry subsidiary/department/class dimensions this shape omits.
 */
export interface NetSuiteTransactionRow {
  trandate: string;
  account?: string;
  subsidiary?: string;
  memo?: string;
  amount?: number | string;
  currency?: string;
  internalid?: string;
}

/**
 * Assumed Xero bank/GL transaction export row.
 * Field names guessed; Xero exports vary by report and locale.
 */
export interface XeroTransactionRow {
  Date: string;
  'Account Code'?: string;
  Narration?: string;
  Amount?: number | string;
  'Transaction Type'?: string;
}

/**
 * Assumed QuickBooks general-ledger export row.
 * Field names guessed; QBO exports vary by report and locale.
 */
export interface QuickBooksTransactionRow {
  'Txn Date'?: string;
  Account?: string;
  Memo?: string;
  Amount?: number | string;
  Class?: string;
}

export interface ErpAdapter {
  /** Display name, e.g. 'NetSuite'. */
  displayName: string;
  /**
   * Normalizes an assumed export row to the canonical pipeline input.
   * Pure; coercion rules are guessed and UNVALIDATED.
   */
  normalize(row: unknown): GlRowInput;
}

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function asAmount(value: unknown): Decimal.Value {
  if (value === undefined || value === null || value === '') return '0';
  if (typeof value === 'number') return String(value);
  return String(value).replace(/,/g, '');
}

export const netSuiteAdapter: ErpAdapter = {
  displayName: 'NetSuite',
  normalize(row: unknown): GlRowInput {
    const r = row as NetSuiteTransactionRow;
    // Assumed mapping: trandate -> date, account -> accountId, memo -> narration.
    // account is assumed to already be a ledger account reference usable as-is.
    return {
      tenantId: '', // must be supplied by caller context — assumed, UNVALIDATED
      accountId: asText(r.account),
      transactionDate: asText(r.trandate),
      sourceErp: 'netsuite',
      amount: asAmount(r.amount),
      currency: asText(r.currency) || undefined,
      narration: r.memo ?? null,
      rawPayload: row,
    };
  },
};

export const xeroAdapter: ErpAdapter = {
  displayName: 'Xero',
  normalize(row: unknown): GlRowInput {
    const r = row as XeroTransactionRow;
    return {
      tenantId: '',
      accountId: asText(r['Account Code']),
      transactionDate: asText(r.Date),
      sourceErp: 'xero',
      amount: asAmount(r.Amount),
      narration: r.Narration ?? null,
      rawPayload: row,
    };
  },
};

export const quickBooksAdapter: ErpAdapter = {
  displayName: 'QuickBooks',
  normalize(row: unknown): GlRowInput {
    const r = row as QuickBooksTransactionRow;
    return {
      tenantId: '',
      accountId: asText(r.Account),
      transactionDate: asText(r['Txn Date']),
      sourceErp: 'quickbooks',
      amount: asAmount(r.Amount),
      narration: r.Memo ?? null,
      rawPayload: row,
    };
  },
};

/**
 * Registry of adapters. Only interface-level, no connectivity.
 */
export const erpAdapters: Record<string, ErpAdapter> = {
  netsuite: netSuiteAdapter,
  xero: xeroAdapter,
  quickbooks: quickBooksAdapter,
};
