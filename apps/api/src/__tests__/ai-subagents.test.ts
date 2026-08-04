import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { withTenantContext } from '../config/db.js';
import { tenants } from '../db/schema/tenants.js';
import { entities } from '../db/schema/entities.js';
import { provisionRuns } from '../db/schema/provision-runs.js';
import { provisionEvents } from '../db/schema/provision-events.js';
import { aiRuns } from '../db/schema/ai-runs.js';
import { accounts } from '../db/schema/accounts.js';
import { suggestMapping } from '../modules/import/auto-mapping/precedent-engine.js';
import { runMappingAgent } from '../agent/subagents/mapping-agent.js';
import { draftAuditMemo } from '../agent/subagents/audit-defense.js';
import { mineCredits, creditIdentificationSchema } from '../agent/subagents/credit-miner.js';
import { runTracedSubagent, SubagentTimeoutError } from '../eve/subagent-runner.js';
import crypto from 'crypto';

const { __modelState } = vi.hoisted(() => {
  const state = { mode: 'valid' };
  return { __modelState: state };
});

vi.mock('../eve/model-client.js', () => ({
  callJsonModel: async ({ promptVersion }: { promptVersion?: string }) => {
    if (__modelState.mode === 'fail') {
      throw new Error('mock model failure');
    }
    if (__modelState.mode === 'hang') {
      return new Promise<never>(() => {});
    }
    if (String(promptVersion).includes('stage1')) {
      return {
        parsed: { classifications: [{ accountId: 'acct-1', functionalCategory: 'sga', confidence: 0.92, reasoning: 'mock stage 1' }] },
        raw: '{}',
        provider: 'mock',
        model: 'mock',
      };
    }
    if (String(promptVersion).startsWith('audit-defense')) {
      return {
        parsed: {
          executiveSummary: 'Mock audit defense memo for test tenant',
          etrWalk: [{ description: 'Statutory', amount: 25000, taxImpact: 25000, rateImpactPercent: 0, narrative: 'mock' }],
          technicalMemos: [{ title: 'Meals & Entertainment', ircSection: 'Sec 274(n)', bookTreatment: 'permanent', conclusion: '50% limitation applies', support: 'mock' }],
          riskFlags: [{ severity: 'medium', title: 'Mock risk', description: 'mock risk detail', recommendation: 'review' }],
          qualityScore: 0.9,
        },
        raw: '{}',
        provider: 'mock',
        model: 'mock',
      };
    }
    if (String(promptVersion).startsWith('credit-miner')) {
      return {
        parsed: {
          accountMatches: [{ accountId: 'acct-1', accountName: 'Solar Equipment', balance: 10000, creditType: 'energy_solar', confidence: 0.9, category: 'energy', description: 'solar array' }],
          recommendations: ['Review solar credit'],
        },
        raw: '{}',
        provider: 'mock',
        model: 'mock',
      };
    }
    return {
      parsed: { mappings: [{ accountId: 'acct-1', taxAccountType: 'NODIFF_SALARIES', bookTreatment: 'no_diff', confidenceScore: 0.91, ircSection: 'Sec 162(a)(1)', explanation: 'mock stage 2' }] },
      raw: '{}',
      provider: 'mock',
      model: 'mock',
    };
  },
}));

const TENANT_ID = crypto.randomUUID();
const ENTITY_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();
const ACCOUNT_ID = crypto.randomUUID();

beforeAll(async () => {
  await withTenantContext(TENANT_ID, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: 'AI Subagent Test', slug: `ai-subagent-${TENANT_ID.slice(0, 8)}` }).onConflictDoNothing();
    await tx.insert(entities).values({ id: ENTITY_ID, tenantId: TENANT_ID, externalId: ENTITY_ID, name: 'AI Subagent Entity', type: 'Test' }).onConflictDoNothing();
    await tx.insert(provisionRuns).values({
      id: RUN_ID, tenantId: TENANT_ID, status: 'draft', period: '2026-01-01',
      approvalStatus: 'not_submitted',
    });
    await tx.insert(accounts).values({
      id: ACCOUNT_ID, tenantId: TENANT_ID, externalId: 'acct-1', accountNumber: '1000',
      name: 'Salaries Expense', type: 'Expense', detailType: 'Payroll',
    });
  });
  __modelState.mode = 'valid';
});

afterAll(async () => {
  try {
    await withTenantContext(TENANT_ID, async (tx) => {
      await tx.delete(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
      await tx.delete(aiRuns).where(eq(aiRuns.provisionRunId, RUN_ID));
      await tx.delete(accounts).where(eq(accounts.id, ACCOUNT_ID));
      await tx.delete(provisionRuns).where(eq(provisionRuns.id, RUN_ID));
      await tx.delete(entities).where(eq(entities.id, ENTITY_ID));
      await tx.delete(tenants).where(eq(tenants.id, TENANT_ID));
    });
  } catch { /* ok */ }
});

describe('AI subagent lifecycle (Phase 3)', () => {
  it('waits for completion and persists validated JSON output', async () => {
    __modelState.mode = 'valid';

    const result = await withTenantContext(TENANT_ID, (tx) => runTracedSubagent(tx, {
      tenantId: TENANT_ID,
      provisionRunId: RUN_ID,
      workflowName: 'subagent_mapping_agent',
      promptVersion: 'mapping-agent-v1',
      input: {
        tenantId: TENANT_ID,
        tenantName: 'AI Subagent Test',
        accounts: [{ id: 'acct-1', accountNumber: '1000', name: 'Salaries Expense', type: 'Expense' }],
      },
      execute: (input) => runMappingAgent(input),
    }));

    expect(result.success).toBe(true);
    expect((result as { taxMappings: unknown[] }).taxMappings).toHaveLength(1);

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_mapping_agent'),
      )).orderBy(aiRuns.startedAt).limit(1),
    );
    expect(runs[0]).toBeDefined();
    expect(runs[0].status).toBe('completed');
    expect(runs[0].completedAt).not.toBeNull();
    expect((runs[0].outputJson as { taxMappings?: unknown[] }).taxMappings).toHaveLength(1);
  });

  it('marks the run fallback_used when the agent degrades to deterministic fallback', async () => {
    __modelState.mode = 'fail';

    const result = await withTenantContext(TENANT_ID, (tx) => runTracedSubagent(tx, {
      tenantId: TENANT_ID,
      provisionRunId: RUN_ID,
      workflowName: 'subagent_mapping_agent_fallback',
      promptVersion: 'mapping-agent-v1',
      input: {
        tenantId: TENANT_ID,
        tenantName: 'AI Subagent Test',
        accounts: [{ id: 'acct-1', accountNumber: '1000', name: 'Salaries Expense', type: 'Expense' }],
      },
      execute: (input) => runMappingAgent(input),
    }));

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toContain('mock model failure');

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_mapping_agent_fallback'),
      )).orderBy(aiRuns.startedAt).limit(1),
    );
    expect(runs[0].status).toBe('fallback_used');
    expect(runs[0].errorMessage).toContain('mock model failure');
  });

  it('keeps the deterministic engine intact when the model fails', async () => {
    __modelState.mode = 'fail';

    const account = await withTenantContext(TENANT_ID, async (tx) => {
      const rows = await tx.select().from(accounts).where(eq(accounts.id, ACCOUNT_ID)).limit(1);
      return rows[0];
    });

    const suggestion = await withTenantContext(TENANT_ID, (tx) => suggestMapping(tx, TENANT_ID, account, []));

    expect(suggestion.matchedBy).toBe('fallback');
    expect(suggestion.taxAccountType).toBeTruthy();
    expect(suggestion.bookTreatment).toBe('no_diff');

    const mappingRuns = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(eq(aiRuns.provisionRunId, RUN_ID)),
    );
    const withFailure = mappingRuns.filter((r) => r.status === 'failed' || r.status === 'fallback_used');
    expect(withFailure.length).toBeGreaterThan(0);
  });

  it('times out hanging subagents and records the timeout state', async () => {
    __modelState.mode = 'hang';

    let caught: unknown;
    await withTenantContext(TENANT_ID, async (tx) => {
      try {
        await runTracedSubagent(tx, {
          tenantId: TENANT_ID,
          provisionRunId: RUN_ID,
          workflowName: 'subagent_hang',
          promptVersion: 'v1',
          timeoutMs: 100,
          input: { tenantId: TENANT_ID, tenantName: 'AI Subagent Test', accounts: [] },
          execute: (input) => runMappingAgent(input),
        });
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(SubagentTimeoutError);

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_hang'),
      )).limit(1),
    );
    expect(runs[0].status).toBe('timeout');
    expect(runs[0].completedAt).not.toBeNull();
  });

  it('marks a run failed when execute throws and logs the failure event', async () => {
    let caught: unknown;
    await withTenantContext(TENANT_ID, async (tx) => {
      try {
        await runTracedSubagent(tx, {
          tenantId: TENANT_ID,
          provisionRunId: RUN_ID,
          workflowName: 'subagent_throwing',
          promptVersion: 'v1',
          input: {},
          execute: async () => { throw new Error('boom'); },
        });
      } catch (err) {
        caught = err;
      }
    });
    expect((caught as Error).message).toBe('boom');

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_throwing'),
      )).limit(1),
    );
    expect(runs[0].status).toBe('failed');
    expect(runs[0].errorMessage).toBe('boom');

    const events = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID)),
    );
    expect(events.map((e) => e.eventType)).toContain('ai.workflow.failed');
  });

  it('persists the audit-defense memo output on completion', async () => {
    __modelState.mode = 'valid';

    const result = await withTenantContext(TENANT_ID, (tx) => runTracedSubagent(tx, {
      tenantId: TENANT_ID,
      provisionRunId: RUN_ID,
      workflowName: 'subagent_audit_defense',
      promptVersion: 'audit-defense-v2',
      input: {
        entityName: 'AI Subagent Entity',
        period: '2026-01-01',
        bookIncome: 100000,
        effectiveTaxRate: 0.25,
        statutoryRate: 0.25,
        totalTaxExpense: 25000,
        currentTaxExpense: 25000,
        deferredTaxExpense: 0,
        taxPayable: 25000,
        etrLines: [],
        permanentDifferences: [],
        temporaryDifferences: [],
      },
      execute: (input) => draftAuditMemo(input),
    }));

    expect(result.executiveSummary).toContain('Mock audit defense memo');
    expect((result as { technicalMemos: unknown[] }).technicalMemos).toHaveLength(1);

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_audit_defense'),
      )).orderBy(aiRuns.startedAt).limit(1),
    );
    expect(runs[0].status).toBe('completed');
    expect((runs[0].outputJson as { executiveSummary?: string }).executiveSummary).toContain('Mock audit defense memo');
    expect((runs[0].outputJson as { riskFlags?: unknown[] }).riskFlags).toHaveLength(1);
  });

  it('persists credit-miner output with deterministic credit amounts', async () => {
    __modelState.mode = 'valid';

    const result = await withTenantContext(TENANT_ID, (tx) => runTracedSubagent(tx, {
      tenantId: TENANT_ID,
      provisionRunId: RUN_ID,
      workflowName: 'subagent_credit_miner',
      promptVersion: 'credit-miner-v1',
      input: {
        tenantId: TENANT_ID,
        tenantName: 'AI Subagent Test',
        period: '2026-01-01',
        fiscalYear: 2026,
        trialBalance: [{ accountId: 'acct-1', accountName: 'Solar Equipment', accountNumber: '1000', accountType: 'Expense', balance: 10000 }],
      },
      execute: (input) => mineCredits(input),
    }));

    expect((result as { energyCredits: Array<{ estimatedCredit: number }> }).energyCredits).toHaveLength(1);
    expect((result as { energyCredits: Array<{ estimatedCredit: number }> }).energyCredits[0].estimatedCredit).toBe(3000);

    const runs = await withTenantContext(TENANT_ID, async (tx) =>
      tx.select().from(aiRuns).where(and(
        eq(aiRuns.tenantId, TENANT_ID),
        eq(aiRuns.provisionRunId, RUN_ID),
        eq(aiRuns.workflowName, 'subagent_credit_miner'),
      )).orderBy(aiRuns.startedAt).limit(1),
    );
    expect(runs[0].status).toBe('completed');
    expect((runs[0].outputJson as { energyCredits?: Array<{ estimatedCredit: number }> }).energyCredits?.[0].estimatedCredit).toBe(3000);
  });

  it('accepts numeric confidence from the provider and maps it to a label', async () => {
    __modelState.mode = 'valid';

    const result = await mineCredits({
      tenantId: TENANT_ID,
      tenantName: 'AI Subagent Test',
      period: '2026-01-01',
      fiscalYear: 2026,
      trialBalance: [{ accountId: 'acct-1', accountName: 'Solar Equipment', accountNumber: '1000', accountType: 'Expense', balance: 10000 }],
    });

    expect(result.success).toBe(true);
    expect(result.energyCredits).toHaveLength(1);
    expect(result.energyCredits[0].confidence).toBe('high');
  });

  it('credit-miner output schema validates numeric and coercible-string confidence, rejects labels', () => {
    const base = {
      accountMatches: [{ accountId: 'acct-1', accountName: 'R&D Wages', balance: 1000, creditType: 'rd_credit', category: 'wages', confidence: 0.9, description: 'engineer wages' }],
      recommendations: ['review'],
    };
    expect(creditIdentificationSchema.safeParse({ ...base }).success).toBe(true);
    expect(creditIdentificationSchema.safeParse({
      ...base,
      accountMatches: [{ ...base.accountMatches[0], confidence: 0.87 }],
    }).success).toBe(true);
    expect(creditIdentificationSchema.safeParse({
      ...base,
      accountMatches: [{ ...base.accountMatches[0], confidence: '0.87' }],
    }).success).toBe(true);
    expect(creditIdentificationSchema.safeParse({
      ...base,
      accountMatches: [{ ...base.accountMatches[0], confidence: 'medium' }],
    }).success).toBe(false);
  });
});
