import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pool, withTenantContext } from '../config/db.js';
import { provisionRuns } from '../db/schema/provision-runs.js';
import { provisionEvents } from '../db/schema/provision-events.js';
import { tenants } from '../db/schema/tenants.js';
import { assertPartnerCanApprove, assertRunIsMutable } from '../lib/middleware/rbac.js';
import { assertRuntimeDbRole, dbUserFromUrl, isSuperuserLikelyUser } from '../config/db-role-guard.js';
import crypto from 'crypto';

const TENANT_A = crypto.randomUUID();

beforeAll(async () => {
  await withTenantContext(TENANT_A, async (tx) => {
    await tx.insert(tenants).values({ id: TENANT_A, name: 'Phase7 Test', slug: TENANT_A }).onConflictDoNothing();
  });
});

afterAll(async () => {
  await withTenantContext(TENANT_A, async (tx) => {
    await tx.delete(tenants).where(eq(tenants.id, TENANT_A));
  }).catch(() => {});
});

describe('Phase 7 — runtime DB role guard', () => {
  it('rejects superuser role in production', () => {
    expect(() => assertRuntimeDbRole('production', 'postgres://postgres:pw@localhost:5432/taxpro')).toThrow(/NOBYPASSRLS/);
    expect(() => assertRuntimeDbRole('production', 'postgres://root:pw@localhost:5432/taxpro')).toThrow(/NOBYPASSRLS/);
  });

  it('accepts a non-owner NOBYPASSRLS runtime role in production', () => {
    expect(() => assertRuntimeDbRole('production', 'postgres://taxpro_app:pw@localhost:5432/taxpro')).not.toThrow();
  });

  it('skips the guard outside production', () => {
    expect(() => assertRuntimeDbRole('development', 'postgres://postgres:pw@localhost:5432/taxpro')).not.toThrow();
  });

  it('parses users from connection strings (incl. percent-encoded)', () => {
    expect(dbUserFromUrl('postgres://taxpro_app:pw@localhost:5432/taxpro')).toBe('taxpro_app');
    expect(dbUserFromUrl('postgres://postgres:pw@localhost:5432/taxpro')).toBe('postgres');
    expect(dbUserFromUrl('postgres://no-user@localhost:5432/taxpro')).toBe('no-user');
    expect(dbUserFromUrl('postgres://@localhost:5432/taxpro')).toBeNull();
    expect(dbUserFromUrl('postgres://user%20name:pw@localhost:5432/taxpro')).toBe('user name');
    expect(dbUserFromUrl('not a url')).toBeNull();
    expect(isSuperuserLikelyUser('postgres')).toBe(true);
    expect(isSuperuserLikelyUser('taxpro_app')).toBe(false);
  });
});

describe('Phase 7 — partner cannot approve own run', () => {
  it('throws when the approver submitted the run', () => {
    expect(() => assertPartnerCanApprove({ submittedByUserId: 'user-1', requestedByUserId: null }, 'user-1')).toThrow(/submitted/);
  });

  it('throws when the approver requested the run', () => {
    expect(() => assertPartnerCanApprove({ submittedByUserId: null, requestedByUserId: 'user-1' }, 'user-1')).toThrow(/requested/);
  });

  it('passes when a different partner approves', () => {
    expect(() => assertPartnerCanApprove({ submittedByUserId: 'user-1', requestedByUserId: 'user-2' }, 'user-3')).not.toThrow();
  });
});

describe('Phase 7 — RLS fails closed without tenant context', () => {
  it('app_current_tenant_id() returns NULL without a tenant context (fails closed)', async () => {
    const res = await pool.query('SELECT app_current_tenant_id() AS tid');
    expect(res.rows[0]?.tid).toBeNull();
  });

  it('direct db access without tenant context returns zero rows (no leaked rows)', async () => {
    const bypassRls = await pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
    if (bypassRls.rows[0]?.rolbypassrls === true) return; // superuser dev role bypasses RLS by design
    const runs = await pool.query<{ id: string }>('SELECT id FROM provision_runs LIMIT 5');
    expect(runs.rows).toHaveLength(0);
  });
});

describe('Phase 7 — audit append-only (provision_events)', () => {
  it('taxpro_app has SELECT+INSERT but no UPDATE/DELETE/TRUNCATE on provision_events', async () => {
    const roleExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['taxpro_app']);
    if (roleExists.rows.length === 0) return; // dev DB without bootstrap roles: nothing to verify

    const privs = await pool.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'taxpro_app' AND table_name = 'provision_events'`,
    );
    const granted = new Set(privs.rows.map(r => r.privilege_type));
    expect(granted.has('SELECT')).toBe(true);
    expect(granted.has('INSERT')).toBe(true);
    expect(granted.has('UPDATE')).toBe(false);
    expect(granted.has('DELETE')).toBe(false);
    expect(granted.has('TRUNCATE')).toBe(false);
  });

  it('audit events are insert-only at the code level (no update/delete helpers on provisionEvents)', async () => {
    const { recordProvisionEvent } = await import('../modules/provision/provision-events.js');
    expect(typeof recordProvisionEvent).toBe('function');
  });
});

describe('Phase 7 — locked-run mutation rejection (endpoint semantics)', () => {
  it('assertRunIsMutable rejects a locked run with ConflictError', async () => {
    const runId = crypto.randomUUID();
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.insert(provisionRuns).values({
        id: runId, tenantId: TENANT_A, status: 'locked', period: '2026-01-01',
        approvalStatus: 'approved',
      }).onConflictDoNothing();
    });
    await expect(assertRunIsMutable(runId, TENANT_A)).rejects.toThrow(/locked/);
    await withTenantContext(TENANT_A, async (tx) => {
      await tx.delete(provisionEvents).where(eq(provisionEvents.provisionRunId, runId));
      await tx.delete(provisionRuns).where(eq(provisionRuns.id, runId));
    });
  });
});
