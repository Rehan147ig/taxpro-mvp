import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTenantContext } from '../config/db.js';
import { provisionRuns } from '../db/schema/provision-runs.js';
import { tenants } from '../db/schema/tenants.js';
import { entities } from '../db/schema/entities.js';
import { requireRunAccess, assertRunIsMutable } from '../lib/middleware/rbac.js';
import crypto from 'crypto';

const TENANT_A = crypto.randomUUID();
const TENANT_B = crypto.randomUUID();
const ENTITY_A = crypto.randomUUID();
const ENTITY_B = crypto.randomUUID();
const RUN_A = crypto.randomUUID();
const RUN_B = crypto.randomUUID();

beforeAll(async () => {
  for (const { tid, eid } of [{ tid: TENANT_A, eid: ENTITY_A }, { tid: TENANT_B, eid: ENTITY_B }]) {
    await withTenantContext(tid, async (tx) => {
      await tx.insert(tenants).values({ id: tid, name: `Test ${tid.slice(0, 8)}`, slug: tid }).onConflictDoNothing();
      await tx.insert(entities).values({ id: eid, tenantId: tid, externalId: eid, name: `${tid.slice(0, 8)} Entity`, type: 'Test' }).onConflictDoNothing();
    });
  }

  await withTenantContext(TENANT_A, async (tx) => {
    await tx.insert(provisionRuns).values({
      id: RUN_A, tenantId: TENANT_A, status: 'draft', period: '2026-01-01',
      approvalStatus: 'not_submitted',
    });
  });
  await withTenantContext(TENANT_B, async (tx) => {
    await tx.insert(provisionRuns).values({
      id: RUN_B, tenantId: TENANT_B, status: 'draft', period: '2026-01-01',
      approvalStatus: 'not_submitted',
    });
  });
});

afterAll(async () => {
  // Cleanup
  for (const [rid, tid, eid] of [[RUN_A, TENANT_A, ENTITY_A], [RUN_B, TENANT_B, ENTITY_B]]) {
    try {
      await withTenantContext(tid, async (tx) => {
        await tx.delete(provisionRuns).where(eq(provisionRuns.id, rid));
        await tx.delete(entities).where(eq(entities.id, eid));
        await tx.delete(tenants).where(eq(tenants.id, tid));
      });
    } catch { /* ok */ }
  }
});

describe('Phase 3.1 — RLS Tenant Isolation', () => {

  it('tenant A can read its own run', async () => {
    const run = await withTenantContext(TENANT_A, async (tx) => {
      const r = await tx.select().from(provisionRuns).where(eq(provisionRuns.id, RUN_A)).limit(1);
      return r[0];
    });
    expect(run).toBeDefined();
    expect(run.tenantId).toBe(TENANT_A);
  });

  it('tenant B can read its own run', async () => {
    const run = await withTenantContext(TENANT_B, async (tx) => {
      const r = await tx.select().from(provisionRuns).where(eq(provisionRuns.id, RUN_B)).limit(1);
      return r[0];
    });
    expect(run).toBeDefined();
    expect(run.tenantId).toBe(TENANT_B);
  });

  it('requireRunAccess passes for correct tenant', async () => {
    await expect(
      requireRunAccess(RUN_A, TENANT_A),
    ).resolves.toBeDefined();
  });

  it('requireRunAccess rejects cross-tenant access', async () => {
    await expect(
      requireRunAccess(RUN_A, TENANT_B),
    ).rejects.toThrow('Cross-tenant');
  });

  it('assertRunIsMutable passes for draft run of correct tenant', async () => {
    await expect(
      assertRunIsMutable(RUN_A, TENANT_A),
    ).resolves.toBeUndefined();
  });

});

describe('Phase 3.2 — Locking & FOR UPDATE', () => {

  it('lock run via withTenantContext + FOR UPDATE', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const [run] = await tx.select().from(provisionRuns)
        .where(eq(provisionRuns.id, RUN_A))
        .limit(1)
        .for('update');
      expect(run).toBeDefined();
      await tx.update(provisionRuns)
        .set({ status: 'locked' })
        .where(eq(provisionRuns.id, RUN_A));
    });
    const check = await withTenantContext(TENANT_A, async (tx) => {
      const r = await tx.select().from(provisionRuns).where(eq(provisionRuns.id, RUN_A)).limit(1);
      return r[0];
    });
    expect(check.status).toBe('locked');
  });

  it('assertRunIsMutable throws on locked run', async () => {
    await expect(
      assertRunIsMutable(RUN_A, TENANT_A),
    ).rejects.toThrow('locked');
  });

  it('unlock run again', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const [run] = await tx.select().from(provisionRuns)
        .where(eq(provisionRuns.id, RUN_A))
        .limit(1)
        .for('update');
      await tx.update(provisionRuns)
        .set({ status: 'draft' })
        .where(eq(provisionRuns.id, RUN_A));
    });
    const check = await withTenantContext(TENANT_A, async (tx) => {
      const r = await tx.select().from(provisionRuns).where(eq(provisionRuns.id, RUN_A)).limit(1);
      return r[0];
    });
    expect(check.status).toBe('draft');
  });

  it('FOR UPDATE lock + select works without error', async () => {
    await withTenantContext(TENANT_A, async (tx) => {
      const [run] = await tx.select().from(provisionRuns)
        .where(eq(provisionRuns.id, RUN_A))
        .limit(1)
        .for('update');
      expect(run).toBeDefined();
    });
  });

});

describe('Phase 3.3 — Import Pipeline (CH worker)', () => {

  it('isRateLimitError detects retryAfter property (not HTTP status)', async () => {
    const { isRateLimitError } = await import('../modules/import/companies-house/client.js');
    const rateErr = new Error('Rate limited');
    (rateErr as any).retryAfter = 5;
    expect(isRateLimitError(rateErr)).toBe(true);
    expect(isRateLimitError(new Error('Generic'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError({})).toBe(false);
  });

});
