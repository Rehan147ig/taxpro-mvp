// Tests for the GL ELT pipeline.
//
// UNVALIDATED — built from public reference material only, not reviewed by a
// CPA, tax attorney, or real ERP export. Every heuristic and assumption below
// is a guess to be corrected by a domain expert or real data, not a claim of
// correctness.

import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { runGlEltPipeline, DEFAULT_GL_CHUNK_SIZE } from '../elt/pipeline.js';
import { netSuiteAdapter, quickBooksAdapter, xeroAdapter } from '../elt/adapters.js';
import type { GlRowInput } from '../elt/adapters.js';

function rows(n: number): GlRowInput[] {
  return Array.from({ length: n }, (_, i) => ({
    tenantId: 't1',
    accountId: `acct-${i % 3}`,
    transactionDate: '2025-06-01',
    sourceErp: 'netsuite',
    amount: '10.00',
    narration: i % 5 === 0 ? 'Client dinner' : 'Office supplies',
  }));
}

describe('runGlEltPipeline', () => {
  it('defaults to a 5,000-row chunk size', () => {
    expect(DEFAULT_GL_CHUNK_SIZE).toBe(5000);
  });

  it('processes all rows and chunks them correctly', async () => {
    const input = rows(13);
    const chunkSizes: number[] = [];
    const result = await runGlEltPipeline(input, {
      chunkSize: 5,
      onChunk: (_i, chunk) => {
        chunkSizes.push(chunk.rows.length);
      },
    });
    expect(chunkSizes).toEqual([5, 5, 3]);
    expect(result.chunks).toBe(3);
    expect(result.processed).toBe(13);
    expect(result.normalized).toHaveLength(13);
  });

  it('coerces amounts to Decimal', async () => {
    const result = await runGlEltPipeline(rows(1));
    expect(result.normalized[0].amount).toBeInstanceOf(Decimal);
    expect(result.normalized[0].amount.toFixed(2)).toBe('10.00');
  });

  it('applies narration heuristics and aggregates findings', async () => {
    const input = rows(5); // rows 0 and 5-style narrations: i=0 is 'Client dinner'
    const result = await runGlEltPipeline(input);
    expect(result.findings.some((f) => f.flag === 'NON_DEDUCTIBLE_ENTERTAINMENT')).toBe(true);
  });

  it('skips rows with missing required fields and reports the reason', async () => {
    const input: GlRowInput[] = [
      rows(1)[0],
      { tenantId: 't1', accountId: '', transactionDate: '2025-06-01', sourceErp: 'netsuite', amount: '1' },
      { tenantId: 't1', accountId: 'a', transactionDate: '', sourceErp: 'netsuite', amount: '1' },
    ];
    const result = await runGlEltPipeline(input);
    expect(result.processed).toBe(1);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toContain('accountId');
    expect(result.skipped[0].rowIndex).toBe(1);
  });

  it('skips non-numeric amounts', async () => {
    const input = [{ ...rows(1)[0], amount: 'not-a-number' }];
    const result = await runGlEltPipeline(input);
    expect(result.processed).toBe(0);
    expect(result.skipped[0].reason).toContain('not a number');
  });

  it('calls the load sink per chunk with the exact chunk contents', async () => {
    const input = rows(7);
    const loaded: number[] = [];
    const result = await runGlEltPipeline(input, {
      chunkSize: 4,
      load: (chunk) => {
        loaded.push(chunk.length);
      },
    });
    expect(loaded).toEqual([4, 3]);
    expect(result.processed).toBe(7);
  });

  it('propagates load errors', async () => {
    const input = rows(2);
    await expect(
      runGlEltPipeline(input, {
        load: () => {
          throw new Error('db down');
        },
      }),
    ).rejects.toThrow('db down');
  });

  it('defaults currency to USD', async () => {
    const result = await runGlEltPipeline(rows(1));
    expect(result.normalized[0].currency).toBe('USD');
  });

  it('preserves input order in normalized output', async () => {
    const input = rows(3).map((r, i) => ({ ...r, accountId: `order-${i}` }));
    const result = await runGlEltPipeline(input);
    expect(result.normalized.map((n) => n.accountId)).toEqual(['order-0', 'order-1', 'order-2']);
  });

  it('handles an empty input', async () => {
    const result = await runGlEltPipeline([]);
    expect(result.chunks).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.normalized).toHaveLength(0);
  });
});

describe('adapter normalizers', () => {
  it('normalizes an assumed NetSuite row', () => {
    const out = netSuiteAdapter.normalize({ trandate: '2025-06-01', account: '1000', memo: 'Client dinner', amount: '25.50' });
    expect(out.sourceErp).toBe('netsuite');
    expect(out.transactionDate).toBe('2025-06-01');
    expect(out.narration).toBe('Client dinner');
    expect(new Decimal(out.amount).toFixed(2)).toBe('25.50');
  });

  it('normalizes an assumed Xero row', () => {
    const out = xeroAdapter.normalize({ Date: '2025-06-01', 'Account Code': '6300', Narration: 'Late payment fee', Amount: '12' });
    expect(out.sourceErp).toBe('xero');
    expect(out.accountId).toBe('6300');
  });

  it('normalizes an assumed QuickBooks row', () => {
    const out = quickBooksAdapter.normalize({ 'Txn Date': '2025-06-01', Account: 'Office Expense', Memo: 'supplies', Amount: '8' });
    expect(out.sourceErp).toBe('quickbooks');
    expect(out.narration).toBe('supplies');
  });

  it('strips thousands separators from amounts', () => {
    const out = netSuiteAdapter.normalize({ trandate: '2025-06-01', account: '1000', amount: '1,234.56' });
    expect(new Decimal(out.amount).toFixed(2)).toBe('1234.56');
  });

  it('defaults missing amounts to zero rather than throwing', () => {
    const out = xeroAdapter.normalize({ Date: '2025-06-01' });
    expect(new Decimal(out.amount).toFixed(2)).toBe('0.00');
  });
});
