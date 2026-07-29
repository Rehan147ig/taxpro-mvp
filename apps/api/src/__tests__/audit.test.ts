import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTenantContext } from '../config/db.js';
import { provisionRuns } from '../db/schema/provision-runs.js';
import { provisionEvents } from '../db/schema/provision-events.js';
import { tenants } from '../db/schema/tenants.js';
import { entities } from '../db/schema/entities.js';
import { users } from '../db/schema/users.js';
import { auditSensitiveOp } from '../modules/provision/audit.js';
import crypto from 'crypto';

const TENANT_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();
const ENTITY_ID = crypto.randomUUID();
const USER_ID = crypto.randomUUID();

beforeAll(async () => {
  await withTenantContext(TENANT_ID, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_ID, name: 'Audit Test', slug: TENANT_ID }).onConflictDoNothing();
    await tx.insert(users).values({ id: USER_ID, tenantId: TENANT_ID, email: `audit-${USER_ID}@test.com`, passwordHash: 'dummy' }).onConflictDoNothing();
    await tx.insert(entities).values({ id: ENTITY_ID, tenantId: TENANT_ID, externalId: ENTITY_ID, name: 'Audit Entity', type: 'Test' }).onConflictDoNothing();
    await tx.insert(provisionRuns).values({
      id: RUN_ID, tenantId: TENANT_ID, status: 'draft', period: '2026-01-01',
      approvalStatus: 'not_submitted',
    }).onConflictDoNothing();
  });
});

afterAll(async () => {
  await withTenantContext(TENANT_ID, async (tx) => {
    await tx.delete(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    await tx.delete(provisionRuns).where(eq(provisionRuns.id, RUN_ID));
    await tx.delete(users).where(eq(users.id, USER_ID));
    await tx.delete(entities).where(eq(entities.id, ENTITY_ID));
    await tx.delete(tenants).where(eq(tenants.id, TENANT_ID));
  }).catch(() => {});
});

describe('Part 1 — Audit Log for Sensitive Ops', () => {

  it('auditSensitiveOp records run.locked event', async () => {
    await withTenantContext(TENANT_ID, async (tx) => {
      await auditSensitiveOp(tx, {
        tenantId: TENANT_ID,
        runId: RUN_ID,
        action: 'run.locked',
        actorUserId: USER_ID,
        actorRole: 'admin',
        details: { previousStatus: 'draft' },
      });
    });

    const events = await withTenantContext(TENANT_ID, async (tx) => {
      return tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    });

    const lockEvent = events.find(e => e.eventType === 'run.locked');
    expect(lockEvent).toBeDefined();
    expect(lockEvent!.actorUserId).toBe(USER_ID);
    expect(lockEvent!.actorType).toBe('user');
    if (lockEvent!.metadata) {
      const meta = typeof lockEvent!.metadata === 'string' ? JSON.parse(lockEvent!.metadata) : lockEvent!.metadata;
      expect(meta).toMatchObject({ actorRole: 'admin', previousStatus: 'draft' });
    }
  });

  it('auditSensitiveOp records run.unlocked event', async () => {
    await withTenantContext(TENANT_ID, async (tx) => {
      await auditSensitiveOp(tx, {
        tenantId: TENANT_ID,
        runId: RUN_ID,
        action: 'run.unlocked',
        actorUserId: USER_ID,
        actorRole: 'partner',
        details: { previousStatus: 'locked' },
      });
    });

    const events = await withTenantContext(TENANT_ID, async (tx) => {
      return tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    });

    const unlockEvent = events.find(e => e.eventType === 'run.unlocked');
    expect(unlockEvent).toBeDefined();
    expect(unlockEvent!.actorUserId).toBe(USER_ID);
  });

  it('auditSensitiveOp records run.finalized event', async () => {
    await withTenantContext(TENANT_ID, async (tx) => {
      await auditSensitiveOp(tx, {
        tenantId: TENANT_ID,
        runId: RUN_ID,
        action: 'run.finalized',
        actorUserId: USER_ID,
        actorRole: 'partner',
        details: { etrVariance: null, finalizedAt: new Date().toISOString() },
      });
    });

    const events = await withTenantContext(TENANT_ID, async (tx) => {
      return tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    });

    const finalizeEvent = events.find(e => e.eventType === 'run.finalized');
    expect(finalizeEvent).toBeDefined();
  });

  it('auditSensitiveOp records mapping.overridden event', async () => {
    await withTenantContext(TENANT_ID, async (tx) => {
      await auditSensitiveOp(tx, {
        tenantId: TENANT_ID,
        runId: RUN_ID,
        action: 'mapping.overridden',
        actorUserId: USER_ID,
        actorRole: 'preparer',
        details: { mappingId: 'acct-1', oldCategory: 'Expense', newCategory: 'COGS' },
      });
    });

    const events = await withTenantContext(TENANT_ID, async (tx) => {
      return tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    });

    const mappingEvent = events.find(e => e.eventType === 'mapping.override');
    expect(mappingEvent).toBeDefined();
  });

  it('audit log has all 4 event types recorded', async () => {
    const events = await withTenantContext(TENANT_ID, async (tx) => {
      return tx.select().from(provisionEvents).where(eq(provisionEvents.provisionRunId, RUN_ID));
    });
    const eventTypes = events.map(e => e.eventType);
    expect(eventTypes).toContain('run.locked');
    expect(eventTypes).toContain('run.unlocked');
    expect(eventTypes).toContain('run.finalized');
    expect(eventTypes).toContain('mapping.override');
  });

});
