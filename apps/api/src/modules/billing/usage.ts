import { and, eq, gte, lte, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { usageEvents } from '../../db/schema/usage-events.js';

/**
 * Per-provision metering and billing.
 *
 * One usage event is recorded per completed provision run, at the unit price
 * configured at the time (price is snapshotted, never re-rated). R&D outcome
 * share (3-5% of claim value) and the team SaaS tier sit on top of this base
 * metering — see pricing.ts for the plan matrix.
 */

export const BILLING = {
  DEFAULT_PRICE_PER_PROVISION: 50,   // £/run base price (SME firm plan)
  TRIAL_FREE_RUNS_PER_MONTH: 1,      // first run each month is free (acquisition)
} as const;

export const EVENT_PROVISION_COMPLETED = 'provision_completed';

export function pricePerProvision(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BILLING_PRICE_PER_PROVISION ?? BILLING.DEFAULT_PRICE_PER_PROVISION);
  return Number.isFinite(raw) && raw >= 0 ? raw : BILLING.DEFAULT_PRICE_PER_PROVISION;
}

export interface RecordUsageInput {
  tenantId: string;
  provisionRunId: string;
  quantity?: number;
  unitPrice?: number;
  metadata?: Record<string, unknown>;
}

export async function recordUsageEvent(tx: NodePgDatabase<any>, input: RecordUsageInput): Promise<void> {
  const unitPrice = input.unitPrice ?? pricePerProvision();
  const quantity = input.quantity ?? 1;
  await tx.insert(usageEvents).values({
    tenantId: input.tenantId,
    eventType: EVENT_PROVISION_COMPLETED,
    provisionRunId: input.provisionRunId,
    quantity: String(quantity),
    unitPrice: String(unitPrice),
    amount: String(round2(quantity * unitPrice)),
    metadata: input.metadata,
  });
}

export interface UsagePeriodFilter {
  tenantId: string;
  from?: string; // ISO date
  to?: string;   // ISO date
}

export interface UsageSummary {
  runs: number;
  freeRuns: number;
  billableRuns: number;
  totalAmount: number;
  events: Array<{
    id: string;
    occurredAt: string;
    eventType: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    metadata: Record<string, unknown> | null;
  }>;
}

export async function summarizeUsage(tx: NodePgDatabase<any>, filter: UsagePeriodFilter): Promise<UsageSummary> {
  const conds = [eq(usageEvents.tenantId, filter.tenantId)];
  if (filter.from) conds.push(gte(usageEvents.occurredAt, new Date(filter.from)));
  if (filter.to) conds.push(lte(usageEvents.occurredAt, new Date(filter.to)));

  const rows = await tx.select().from(usageEvents)
    .where(and(...conds))
    .orderBy(desc(usageEvents.occurredAt));

  const freeRuns = 0; // free-tier runs are recorded with unit price 0
  const billableRuns = rows.filter(r => Number(r.amount) > 0).length;
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  return {
    runs: rows.length,
    freeRuns,
    billableRuns,
    totalAmount: round2(totalAmount),
    events: rows.map(r => ({
      id: r.id,
      occurredAt: r.occurredAt?.toISOString?.() ?? String(r.occurredAt ?? ''),
      eventType: r.eventType,
      quantity: Number(r.quantity ?? 1),
      unitPrice: Number(r.unitPrice ?? 0),
      amount: Number(r.amount ?? 0),
      metadata: r.metadata as Record<string, unknown> | null,
    })),
  };
}

/** Invoice line for a period — used by the billing endpoint and invoice PDF later. */
export async function buildInvoiceLines(tx: NodePgDatabase<any>, filter: UsagePeriodFilter) {
  const summary = await summarizeUsage(tx, filter);
  const perRun = pricePerProvision();
  return {
    period: { from: filter.from ?? null, to: filter.to ?? null },
    lines: [
      {
        description: `Tax provision runs (${summary.runs} completed)`,
        quantity: summary.billableRuns,
        unitPrice: perRun,
        amount: round2(summary.billableRuns * perRun),
      },
      {
        description: 'R&D claim outcome share (3-5% of claim value, charged at claim acceptance)',
        quantity: 0,
        unitPrice: 0,
        amount: 0,
        note: 'Outcome share is quoted per claim — not metered here',
      },
    ],
    total: round2(summary.billableRuns * perRun),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
