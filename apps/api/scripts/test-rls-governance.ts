/**
 * Phase 3.6 RLS and Governance Strict-Enforcement Integration Tests
 *
 * Run: npx tsx scripts/test-rls-governance.ts
 *
 * Requires PostgreSQL with 0004 migration applied.
 * Tests connect as both an admin role (for setup) and the taxpro_app
 * runtime role to verify strict RLS enforcement.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_URL_MIGRATIONS ?? 'postgres://postgres:postgres@localhost:5432/taxpro';
const APP_URL = process.env.DATABASE_URL ?? ADMIN_URL;

const adminPool = new pg.Pool({ connectionString: ADMIN_URL });
const adminDb = drizzle(adminPool);

const appPool = new pg.Pool({ connectionString: APP_URL });
const appDb = drizzle(appPool);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  FAIL: ${name} — ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n=== Phase 3.6 RLS Strict Enforcement Tests ===\n');

  // Detect which role the app pool connected as
  const whoRes = await appDb.execute(sql`SELECT current_user AS who`);
  const appRole = whoRes.rows[0]?.who ?? 'unknown';
  console.log(`  App pool connected as: ${appRole}`);
  console.log(`  Admin pool connected as: ${(await adminDb.execute(sql`SELECT current_user AS who`)).rows[0]?.who ?? 'unknown'}`);

  function insertId(result: any): string {
    return result.rows[0]?.id ?? '';
  }

  let res: any;

  // 1. Set up two test tenants
  res = await adminDb.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('Phase3.6 Test Tenant A', 'phase36-test-a')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const tenantAId = insertId(res);

  res = await adminDb.execute(sql`
    INSERT INTO tenants (name, slug) VALUES ('Phase3.6 Test Tenant B', 'phase36-test-b')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const tenantBId = insertId(res);

  // 2. Create test provision runs
  res = await adminDb.execute(sql`
    INSERT INTO provision_runs (tenant_id, period, status)
    VALUES (${tenantAId}::uuid, '2026-06-01', 'calculated')
    RETURNING id
  `);
  const runAId = insertId(res);

  res = await adminDb.execute(sql`
    INSERT INTO provision_runs (tenant_id, period, status)
    VALUES (${tenantBId}::uuid, '2026-06-01', 'calculated')
    RETURNING id
  `);
  const runBId = insertId(res);

  // 3. Create test provision results
  res = await adminDb.execute(sql`
    INSERT INTO provision_results (tenant_id, provision_run_id, period)
    VALUES (${tenantAId}::uuid, ${runAId}::uuid, '2026-06-01')
    RETURNING id
  `);
  const resultAId = insertId(res);

  res = await adminDb.execute(sql`
    INSERT INTO provision_results (tenant_id, provision_run_id, period)
    VALUES (${tenantBId}::uuid, ${runBId}::uuid, '2026-06-01')
    RETURNING id
  `);
  const resultBId = insertId(res);

  // 4. Create test events
  await adminDb.execute(sql`
    INSERT INTO provision_events (tenant_id, provision_run_id, event_type, actor_type, occurred_at)
    VALUES (${tenantAId}::uuid, ${runAId}::uuid, 'run.created', 'system', NOW())
  `);
  await adminDb.execute(sql`
    INSERT INTO provision_events (tenant_id, provision_run_id, event_type, actor_type, occurred_at)
    VALUES (${tenantBId}::uuid, ${runBId}::uuid, 'run.created', 'system', NOW())
  `);

  // 5. Create test review items
  res = await adminDb.execute(sql`
    INSERT INTO review_items (tenant_id, provision_run_id, item_type, severity, title)
    VALUES (${tenantAId}::uuid, ${runAId}::uuid, 'test_item', 'low', 'Phase3.6 Test Item A')
    RETURNING id
  `);
  const itemAId = insertId(res);

  res = await adminDb.execute(sql`
    INSERT INTO review_items (tenant_id, provision_run_id, item_type, severity, title)
    VALUES (${tenantBId}::uuid, ${runBId}::uuid, 'test_item', 'low', 'Phase3.6 Test Item B')
    RETURNING id
  `);
  const itemBId = insertId(res);

  // ================================================================
  // Section 1: Strict RLS — Read Isolation (via appDb as taxpro_app)
  // ================================================================

  console.log('\n--- Strict RLS: Read Isolation ---\n');

  await test('Tenant A reads own provision_run', async () => {
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}::text, true)`);
      const rows = await tx.execute(sql`SELECT id FROM provision_runs WHERE id = ${runAId}::uuid`);
      assert(rows.rowCount === 1, 'Expected 1 row for own tenant');
    });
  });

  await test('Tenant A cannot read Tenant B provision_run', async () => {
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}::text, true)`);
      const rows = await tx.execute(sql`SELECT id FROM provision_runs WHERE id = ${runBId}::uuid`);
      assert(rows.rowCount === 0, 'Expected 0 rows for cross-tenant read');
    });
  });

  await test('Missing tenant context returns zero rows (fail-closed)', async () => {
    const rows = await appDb.execute(sql`SELECT id FROM provision_runs LIMIT 1`);
    assert((rows.rowCount ?? 0) === 0, 'Expected 0 rows without tenant context (fail-closed)');
  });

  await test('Missing tenant context blocks writes (fail-closed)', async () => {
    let rejected = false;
    try {
      await appDb.execute(sql`
        INSERT INTO provision_runs (tenant_id, period, status)
        VALUES (${tenantAId}::uuid, '2026-07-01', 'calculated')
      `);
    } catch {
      rejected = true;
    }
    assert(rejected, 'Expected INSERT without tenant context to be blocked by RLS');
  });

  // ================================================================
  // Section 2: Provision events — append-only
  // ================================================================

  console.log('\n--- Append-Only provision_events ---\n');

  await test('INSERT into provision_events succeeds', async () => {
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}::text, true)`);
      await tx.execute(sql`
        INSERT INTO provision_events (tenant_id, provision_run_id, event_type, actor_type, occurred_at)
        VALUES (${tenantAId}::uuid, ${runAId}::uuid, 'test.strict_rls', 'system', NOW())
      `);
    });
  });

  await test('UPDATE on provision_events rejected (privilege revoke)', async () => {
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}::text, true)`);
      let rejected = false;
      try {
        await tx.execute(sql`UPDATE provision_events SET reason = 'attempt' WHERE provision_run_id = ${runAId}::uuid`);
      } catch {
        rejected = true;
      }
      assert(rejected, 'Expected UPDATE to be rejected');
    });
  });

  await test('DELETE on provision_events rejected (privilege revoke)', async () => {
    await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantAId}::text, true)`);
      let rejected = false;
      try {
        await tx.execute(sql`DELETE FROM provision_events WHERE provision_run_id = ${runAId}::uuid`);
      } catch {
        rejected = true;
      }
      assert(rejected, 'Expected DELETE to be rejected');
    });
  });

  // ================================================================
  // Section 3: Startup validation — also run as taxpro_app
  // ================================================================

  const isAppRole = appRole === 'taxpro_app';

  if (isAppRole) {
    console.log('\n--- Startup Validation ---\n');

    await test('taxpro_app should NOT have BYPASSRLS', async () => {
      const res = await appDb.execute(sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      assert(res.rows[0]?.rolbypassrls === false, 'Expected BYPASSRLS=false');
    });

    await test('taxpro_app should NOT own tenant tables', async () => {
      const res = await appDb.execute(sql`
        SELECT COUNT(*) AS cnt FROM pg_class c
        JOIN pg_roles r ON c.relowner = r.oid
        WHERE r.rolname = current_user AND c.relkind = 'r'
      `);
      assert(Number(res.rows[0]?.cnt ?? 0) === 0, 'Expected no owned tables');
    });
  } else {
    console.log('\n  (skipping BYPASSRLS / ownership tests — not connected as taxpro_app)');
  }

  // ================================================================
  // Cleanup
  // ================================================================

  try {
    await adminDb.execute(sql`DELETE FROM provision_events WHERE provision_run_id IN (${runAId}::uuid, ${runBId}::uuid)`);
    await adminDb.execute(sql`DELETE FROM review_items WHERE id IN (${itemAId}::uuid, ${itemBId}::uuid)`);
    await adminDb.execute(sql`DELETE FROM provision_results WHERE id IN (${resultAId}::uuid, ${resultBId}::uuid)`);
    await adminDb.execute(sql`DELETE FROM provision_runs WHERE id IN (${runAId}::uuid, ${runBId}::uuid)`);
    await adminDb.execute(sql`DELETE FROM tenants WHERE id IN (${tenantAId}::uuid, ${tenantBId}::uuid)`);
  } catch (_) {}

  await adminPool.end();
  await appPool.end();

  // ================================================================
  // Summary
  // ================================================================
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
