-- Phase 3.6: Enforce Database Tenant Boundary
-- Replaces COALESCE fallback policies with strict default-deny.
-- Adds tenant_id to ai_steps.
-- Hardens provision_events privileges.
-- Safe to run after 0003_rls_governance_hardening.sql.
-- Rollback notes at bottom.

-- ================================================================
-- 1. Helper function: app_current_tenant_id()
-- ================================================================
-- Returns the tenant_id from the transaction-local setting, or NULL.
-- When NULL, all RLS policies fail closed (uuid = NULL is never true).
-- When set, policies filter to exactly that tenant.

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN current_setting('app.tenant_id')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ================================================================
-- 2. Drop old COALESCE policies and create strict policies
-- ================================================================
-- Each table gets:
--   SELECT policy: USING (tenant_id = app_current_tenant_id())
--   INSERT policy: WITH CHECK (tenant_id = app_current_tenant_id())
--   UPDATE policy: USING + WITH CHECK
--   DELETE policy: USING
--
-- When app_current_tenant_id() returns NULL, ALL operations return
-- zero rows or are rejected. No backward-compatible fallback.

-- ---- provision_runs ----
DROP POLICY IF EXISTS tenant_isolation_read ON provision_runs;
DROP POLICY IF EXISTS tenant_isolation_write ON provision_runs;
DROP POLICY IF EXISTS tenant_isolation_select ON provision_runs;
DROP POLICY IF EXISTS tenant_isolation_insert ON provision_runs;
DROP POLICY IF EXISTS tenant_isolation_update ON provision_runs;
DROP POLICY IF EXISTS tenant_isolation_delete ON provision_runs;
CREATE POLICY tenant_isolation_select ON provision_runs FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON provision_runs FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON provision_runs FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON provision_runs FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- provision_results ----
DROP POLICY IF EXISTS tenant_isolation_read ON provision_results;
DROP POLICY IF EXISTS tenant_isolation_write ON provision_results;
DROP POLICY IF EXISTS tenant_isolation_select ON provision_results;
DROP POLICY IF EXISTS tenant_isolation_insert ON provision_results;
DROP POLICY IF EXISTS tenant_isolation_update ON provision_results;
DROP POLICY IF EXISTS tenant_isolation_delete ON provision_results;
CREATE POLICY tenant_isolation_select ON provision_results FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON provision_results FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON provision_results FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON provision_results FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- provision_events ----
DROP POLICY IF EXISTS tenant_isolation_read ON provision_events;
DROP POLICY IF EXISTS tenant_isolation_write ON provision_events;
DROP POLICY IF EXISTS tenant_isolation_select ON provision_events;
DROP POLICY IF EXISTS tenant_isolation_insert ON provision_events;
CREATE POLICY tenant_isolation_select ON provision_events FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON provision_events FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ---- review_items ----
DROP POLICY IF EXISTS tenant_isolation_read ON review_items;
DROP POLICY IF EXISTS tenant_isolation_write ON review_items;
DROP POLICY IF EXISTS tenant_isolation_select ON review_items;
DROP POLICY IF EXISTS tenant_isolation_insert ON review_items;
DROP POLICY IF EXISTS tenant_isolation_update ON review_items;
DROP POLICY IF EXISTS tenant_isolation_delete ON review_items;
CREATE POLICY tenant_isolation_select ON review_items FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON review_items FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON review_items FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON review_items FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- tax_mappings ----
DROP POLICY IF EXISTS tenant_isolation_read ON tax_mappings;
DROP POLICY IF EXISTS tenant_isolation_write ON tax_mappings;
DROP POLICY IF EXISTS tenant_isolation_select ON tax_mappings;
DROP POLICY IF EXISTS tenant_isolation_insert ON tax_mappings;
DROP POLICY IF EXISTS tenant_isolation_update ON tax_mappings;
DROP POLICY IF EXISTS tenant_isolation_delete ON tax_mappings;
CREATE POLICY tenant_isolation_select ON tax_mappings FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON tax_mappings FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON tax_mappings FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON tax_mappings FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- trial_balance ----
DROP POLICY IF EXISTS tenant_isolation_read ON trial_balance;
DROP POLICY IF EXISTS tenant_isolation_write ON trial_balance;
DROP POLICY IF EXISTS tenant_isolation_select ON trial_balance;
DROP POLICY IF EXISTS tenant_isolation_insert ON trial_balance;
DROP POLICY IF EXISTS tenant_isolation_update ON trial_balance;
DROP POLICY IF EXISTS tenant_isolation_delete ON trial_balance;
CREATE POLICY tenant_isolation_select ON trial_balance FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON trial_balance FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON trial_balance FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON trial_balance FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- accounts ----
DROP POLICY IF EXISTS tenant_isolation_read ON accounts;
DROP POLICY IF EXISTS tenant_isolation_write ON accounts;
DROP POLICY IF EXISTS tenant_isolation_select ON accounts;
DROP POLICY IF EXISTS tenant_isolation_insert ON accounts;
DROP POLICY IF EXISTS tenant_isolation_update ON accounts;
DROP POLICY IF EXISTS tenant_isolation_delete ON accounts;
CREATE POLICY tenant_isolation_select ON accounts FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON accounts FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON accounts FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON accounts FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- entities ----
DROP POLICY IF EXISTS tenant_isolation_read ON entities;
DROP POLICY IF EXISTS tenant_isolation_write ON entities;
DROP POLICY IF EXISTS tenant_isolation_select ON entities;
DROP POLICY IF EXISTS tenant_isolation_insert ON entities;
DROP POLICY IF EXISTS tenant_isolation_update ON entities;
DROP POLICY IF EXISTS tenant_isolation_delete ON entities;
CREATE POLICY tenant_isolation_select ON entities FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON entities FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON entities FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON entities FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- ai_runs ----
DROP POLICY IF EXISTS tenant_isolation_read ON ai_runs;
DROP POLICY IF EXISTS tenant_isolation_write ON ai_runs;
DROP POLICY IF EXISTS tenant_isolation_select ON ai_runs;
DROP POLICY IF EXISTS tenant_isolation_insert ON ai_runs;
DROP POLICY IF EXISTS tenant_isolation_update ON ai_runs;
DROP POLICY IF EXISTS tenant_isolation_delete ON ai_runs;
CREATE POLICY tenant_isolation_select ON ai_runs FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON ai_runs FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON ai_runs FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON ai_runs FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- classification_patterns ----
DROP POLICY IF EXISTS tenant_isolation_read ON classification_patterns;
DROP POLICY IF EXISTS tenant_isolation_write ON classification_patterns;
DROP POLICY IF EXISTS tenant_isolation_select ON classification_patterns;
DROP POLICY IF EXISTS tenant_isolation_insert ON classification_patterns;
DROP POLICY IF EXISTS tenant_isolation_update ON classification_patterns;
DROP POLICY IF EXISTS tenant_isolation_delete ON classification_patterns;
CREATE POLICY tenant_isolation_select ON classification_patterns FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON classification_patterns FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON classification_patterns FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON classification_patterns FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- connections ----
DROP POLICY IF EXISTS tenant_isolation_read ON connections;
DROP POLICY IF EXISTS tenant_isolation_write ON connections;
DROP POLICY IF EXISTS tenant_isolation_select ON connections;
DROP POLICY IF EXISTS tenant_isolation_insert ON connections;
DROP POLICY IF EXISTS tenant_isolation_update ON connections;
DROP POLICY IF EXISTS tenant_isolation_delete ON connections;
CREATE POLICY tenant_isolation_select ON connections FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON connections FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON connections FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON connections FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ---- users ----
DROP POLICY IF EXISTS tenant_isolation_read ON users;
DROP POLICY IF EXISTS tenant_isolation_write ON users;
DROP POLICY IF EXISTS tenant_isolation_select ON users;
DROP POLICY IF EXISTS tenant_isolation_insert ON users;
DROP POLICY IF EXISTS tenant_isolation_update ON users;
DROP POLICY IF EXISTS tenant_isolation_delete ON users;
CREATE POLICY tenant_isolation_select ON users FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON users FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON users FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON users FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- NOTE: ai_steps policies are created in section 3, AFTER tenant_id is added.

-- ================================================================
-- 3. Add tenant_id to ai_steps with backfill
-- ================================================================

ALTER TABLE ai_steps ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

-- Backfill from parent ai_runs
UPDATE ai_steps SET tenant_id = ai_runs.tenant_id
FROM ai_runs
WHERE ai_steps.tenant_id IS NULL
  AND ai_steps.ai_run_id = ai_runs.id;

-- Make NOT NULL after backfill
ALTER TABLE ai_steps ALTER COLUMN tenant_id SET NOT NULL;

-- Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_ai_steps_tenant_id ON ai_steps(tenant_id);

-- ---- ai_steps policies (tenant_id now exists; see section 2 note) ----
DROP POLICY IF EXISTS tenant_isolation_select ON ai_steps;
DROP POLICY IF EXISTS tenant_isolation_insert ON ai_steps;
DROP POLICY IF EXISTS tenant_isolation_update ON ai_steps;
DROP POLICY IF EXISTS tenant_isolation_delete ON ai_steps;
CREATE POLICY tenant_isolation_select ON ai_steps FOR SELECT
  USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_insert ON ai_steps FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_update ON ai_steps FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_delete ON ai_steps FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- Enable RLS on ai_steps now that it is tenant-scoped. Writes go through
-- tenant-context transactions (ai_runs are always created in-context), so
-- strict default-deny policies are safe here.
ALTER TABLE ai_steps ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- 4. Grant / Revoke table privileges for app_tenant role
-- ================================================================
-- These assume the roles exist (run bootstrap-roles.sql first).
-- They are idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      provision_runs, provision_results,
      review_items, tax_mappings, trial_balance,
      accounts, entities, ai_runs, ai_steps,
      classification_patterns, connections, users
    TO taxpro_app;

    -- provision_events is append-only: revoke UPDATE, DELETE, TRUNCATE
    GRANT SELECT, INSERT ON provision_events TO taxpro_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON provision_events FROM taxpro_app;
  END IF;
END $$;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert this migration:
--   1. DROP FUNCTION IF EXISTS app_current_tenant_id();
--   2. For each table listed above:
--        DROP POLICY IF EXISTS tenant_isolation_select ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_insert ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_update ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_delete ON <table>;
--      Then re-create the Phase 3.5 COALESCE policies if needed.
--   3. DROP INDEX IF EXISTS idx_ai_steps_tenant_id;
--   4. ALTER TABLE ai_steps DROP COLUMN IF EXISTS tenant_id;
--   5. REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM taxpro_app;
-- ================================================================
