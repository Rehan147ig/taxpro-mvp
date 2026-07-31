import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BILLING, EVENT_PROVISION_COMPLETED, pricePerProvision, recordUsageEvent, summarizeUsage, buildInvoiceLines } from './usage.js';

function fakeTx(rows: any[] = [], captured: any[] = []) {
  return {
    insert: () => ({
      values: (v: any) => {
        captured.push(v);
        return { returning: async () => [] };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ then: (resolve: any) => resolve(rows) }) }),
        orderBy: () => ({ then: (resolve: any) => resolve(rows) }),
      }),
    }),
  };
}

describe('pricePerProvision', () => {
  beforeEach(() => { delete process.env.BILLING_PRICE_PER_PROVISION; });

  it('defaults to £50 per run', () => {
    expect(pricePerProvision({})).toBe(50);
  });

  it('reads the env override', () => {
    expect(pricePerProvision({ BILLING_PRICE_PER_PROVISION: '35.5' })).toBe(35.5);
  });

  it('falls back on garbage', () => {
    expect(pricePerProvision({ BILLING_PRICE_PER_PROVISION: 'abc' })).toBe(50);
    expect(pricePerProvision({ BILLING_PRICE_PER_PROVISION: '-5' })).toBe(50);
  });
});

describe('recordUsageEvent', () => {
  it('writes one event with snapshotted price and computed amount', async () => {
    const captured: any[] = [];
    await recordUsageEvent(fakeTx([], captured) as any, {
      tenantId: 't1', provisionRunId: 'r1', unitPrice: 50, metadata: { period: '2025-12-31' },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      tenantId: 't1',
      provisionRunId: 'r1',
      eventType: EVENT_PROVISION_COMPLETED,
      quantity: '1',
      unitPrice: '50',
      amount: '50',
    });
    expect(captured[0].metadata.period).toBe('2025-12-31');
  });

  it('honours quantity × unitPrice and custom prices', async () => {
    const captured: any[] = [];
    await recordUsageEvent(fakeTx([], captured) as any, {
      tenantId: 't1', provisionRunId: 'r1', quantity: 2, unitPrice: 37.5,
    });
    expect(captured[0].amount).toBe('75');
  });
});

describe('summarizeUsage', () => {
  it('aggregates rows into a billing summary', async () => {
    const rows = [
      { id: 'a', occurredAt: new Date('2026-01-01'), eventType: 'provision_completed', quantity: '1', unitPrice: '50', amount: '50', metadata: null },
      { id: 'b', occurredAt: new Date('2026-01-02'), eventType: 'provision_completed', quantity: '1', unitPrice: '50', amount: '50', metadata: { jurisdiction: 'UK' } },
      { id: 'c', occurredAt: new Date('2026-01-03'), eventType: 'provision_completed', quantity: '1', unitPrice: '0', amount: '0', metadata: null },
    ];
    const s = await summarizeUsage(fakeTx(rows) as any, { tenantId: 't1', from: '2026-01-01', to: '2026-01-31' });
    expect(s.runs).toBe(3);
    expect(s.billableRuns).toBe(2);
    expect(s.totalAmount).toBe(100);
    expect(s.events[0].metadata).toBeNull();
    expect(s.events[1].metadata).toEqual({ jurisdiction: 'UK' });
  });
});

describe('buildInvoiceLines', () => {
  it('produces a per-run line plus the R&D outcome-share note', async () => {
    const rows = [
      { id: 'a', occurredAt: new Date(), eventType: 'provision_completed', quantity: '1', unitPrice: '50', amount: '50', metadata: null },
      { id: 'b', occurredAt: new Date(), eventType: 'provision_completed', quantity: '1', unitPrice: '50', amount: '50', metadata: null },
    ];
    const inv = await buildInvoiceLines(fakeTx(rows) as any, { tenantId: 't1' });
    expect(inv.lines[0].description).toContain('2 completed');
    expect(inv.lines[0].amount).toBe(100);
    expect(inv.total).toBe(100);
    expect(inv.lines[1].note).toMatch(/outcome share/i);
  });
});

describe('pricing guardrails', () => {
  it('keeps the free trial slice visible', () => {
    expect(BILLING.TRIAL_FREE_RUNS_PER_MONTH).toBe(1);
    expect(BILLING.DEFAULT_PRICE_PER_PROVISION).toBe(50);
  });
});
