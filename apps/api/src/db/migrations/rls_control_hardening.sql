-- Phase 3.5: Database Trust Boundary and Control Hardening
-- Safe RLS rollout + append-only event protection + control gap fixes
-- IMPORTANT: This migration does NOT use FORCE ROW LEVEL SECURITY.
-- Table owners (the migration/application role) bypass RLS by default.
-- RLS provides defense-in-depth for non-owner roles and future app-role separation.
-- Rollback notes at bottom.

-- ================================================================
-- 1a. Enable RLS on all tenant-owned tables
-- ================================================================

-- For each table, the read policy uses COALESCE so that when app.tenant_id
-- is not set, existing application-level WHERE clauses still work.
-- The write policy REQUIREs tenant context — preventing cross-tenant writes
-- even if the app-layer check is bypassed.

DO $$
DECLARE
  tables text[] := ARRAY[
    'provision_runs', 'provision_results', 'provision_events',
    'review_items', 'tax_mappings', 'trial_balance',
    'accounts', 'entities', 'ai_runs', 'classification_patterns',
    'connections', 'users'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- provision_runs
DROP POLICY IF EXISTS tenant_isolation_read ON provision_runs;
CREATE POLICY tenant_isolation_read ON provision_runs FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON provision_runs;
CREATE POLICY tenant_isolation_write ON provision_runs FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON provision_runs;
CREATE POLICY tenant_isolation_update ON provision_runs FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON provision_runs;
CREATE POLICY tenant_isolation_delete ON provision_runs FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- provision_results
DROP POLICY IF EXISTS tenant_isolation_read ON provision_results;
CREATE POLICY tenant_isolation_read ON provision_results FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON provision_results;
CREATE POLICY tenant_isolation_write ON provision_results FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON provision_results;
CREATE POLICY tenant_isolation_update ON provision_results FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON provision_results;
CREATE POLICY tenant_isolation_delete ON provision_results FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- provision_events
DROP POLICY IF EXISTS tenant_isolation_read ON provision_events;
CREATE POLICY tenant_isolation_read ON provision_events FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON provision_events;
CREATE POLICY tenant_isolation_write ON provision_events FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- review_items
DROP POLICY IF EXISTS tenant_isolation_read ON review_items;
CREATE POLICY tenant_isolation_read ON review_items FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON review_items;
CREATE POLICY tenant_isolation_write ON review_items FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON review_items;
CREATE POLICY tenant_isolation_update ON review_items FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON review_items;
CREATE POLICY tenant_isolation_delete ON review_items FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- tax_mappings
DROP POLICY IF EXISTS tenant_isolation_read ON tax_mappings;
CREATE POLICY tenant_isolation_read ON tax_mappings FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON tax_mappings;
CREATE POLICY tenant_isolation_write ON tax_mappings FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON tax_mappings;
CREATE POLICY tenant_isolation_update ON tax_mappings FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON tax_mappings;
CREATE POLICY tenant_isolation_delete ON tax_mappings FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- trial_balance
DROP POLICY IF EXISTS tenant_isolation_read ON trial_balance;
CREATE POLICY tenant_isolation_read ON trial_balance FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON trial_balance;
CREATE POLICY tenant_isolation_write ON trial_balance FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON trial_balance;
CREATE POLICY tenant_isolation_update ON trial_balance FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON trial_balance;
CREATE POLICY tenant_isolation_delete ON trial_balance FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- accounts
DROP POLICY IF EXISTS tenant_isolation_read ON accounts;
CREATE POLICY tenant_isolation_read ON accounts FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON accounts;
CREATE POLICY tenant_isolation_write ON accounts FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON accounts;
CREATE POLICY tenant_isolation_update ON accounts FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON accounts;
CREATE POLICY tenant_isolation_delete ON accounts FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- entities
DROP POLICY IF EXISTS tenant_isolation_read ON entities;
CREATE POLICY tenant_isolation_read ON entities FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON entities;
CREATE POLICY tenant_isolation_write ON entities FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON entities;
CREATE POLICY tenant_isolation_update ON entities FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON entities;
CREATE POLICY tenant_isolation_delete ON entities FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- ai_runs (note: ai_steps does not have tenant_id — access via parent ai_runs)
DROP POLICY IF EXISTS tenant_isolation_read ON ai_runs;
CREATE POLICY tenant_isolation_read ON ai_runs FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON ai_runs;
CREATE POLICY tenant_isolation_write ON ai_runs FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON ai_runs;
CREATE POLICY tenant_isolation_update ON ai_runs FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON ai_runs;
CREATE POLICY tenant_isolation_delete ON ai_runs FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- classification_patterns
DROP POLICY IF EXISTS tenant_isolation_read ON classification_patterns;
CREATE POLICY tenant_isolation_read ON classification_patterns FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON classification_patterns;
CREATE POLICY tenant_isolation_write ON classification_patterns FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON classification_patterns;
CREATE POLICY tenant_isolation_update ON classification_patterns FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON classification_patterns;
CREATE POLICY tenant_isolation_delete ON classification_patterns FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- connections (NetSuite credentials — tenant-scoped)
DROP POLICY IF EXISTS tenant_isolation_read ON connections;
CREATE POLICY tenant_isolation_read ON connections FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON connections;
CREATE POLICY tenant_isolation_write ON connections FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON connections;
CREATE POLICY tenant_isolation_update ON connections FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON connections;
CREATE POLICY tenant_isolation_delete ON connections FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- users (tenant-scoped; tenant_id is the owning tenant)
DROP POLICY IF EXISTS tenant_isolation_read ON users;
CREATE POLICY tenant_isolation_read ON users FOR SELECT
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));
DROP POLICY IF EXISTS tenant_isolation_write ON users;
CREATE POLICY tenant_isolation_write ON users FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_update ON users;
CREATE POLICY tenant_isolation_update ON users FOR UPDATE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id))
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
DROP POLICY IF EXISTS tenant_isolation_delete ON users;
CREATE POLICY tenant_isolation_delete ON users FOR DELETE
  USING (tenant_id = COALESCE(current_setting('app.tenant_id', true)::uuid, tenant_id));

-- Note: ai_steps does NOT have a tenant_id column.
-- It is accessed through ai_runs via ai_run_id FK.
-- RLS at the ai_runs level is sufficient because:
--   (a) ai_steps are always queried by ai_run_id which is already tenant-scoped
--   (b) INSERT/UPDATE/DELETE on ai_steps always goes through a known ai_run_id
-- Future work: add tenant_id to ai_steps if direct-table-access patterns emerge.

-- ================================================================
-- 1b. Create helper function for setting tenant context
-- ================================================================

CREATE OR REPLACE FUNCTION set_app_tenant_context(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
END;
$$;

-- ================================================================
-- 2. Append-only protection for provision_events
-- ================================================================

-- Reject UPDATE and DELETE on provision_events
CREATE OR REPLACE FUNCTION reject_provision_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'provision_events are append-only and cannot be modified or deleted'
      USING HINT = 'Events are immutable records. Insert a new event instead.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provision_events are append-only and cannot be modified or deleted'
      USING HINT = 'Events are immutable records and cannot be removed.';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS provision_events_append_only ON provision_events;
CREATE TRIGGER provision_events_append_only
  BEFORE UPDATE OR DELETE ON provision_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_provision_event_mutation();

-- ================================================================
-- 3. Add preparedByUserId to provision_runs
-- ================================================================

ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS prepared_by_user_id uuid REFERENCES users(id);

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert this migration:
--   1. DROP TRIGGER IF EXISTS provision_events_append_only ON provision_events;
--   2. DROP FUNCTION IF EXISTS reject_provision_event_mutation();
--   3. For each table listed above:
--        ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
--        DROP POLICY IF EXISTS tenant_isolation_read ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_write ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_update ON <table>;
--        DROP POLICY IF EXISTS tenant_isolation_delete ON <table>;
--   4. ALTER TABLE provision_runs DROP COLUMN IF EXISTS prepared_by_user_id;
--   5. DROP FUNCTION IF EXISTS set_app_tenant_context(uuid);
--
-- IMPORTANT: Disabling RLS will remove tenant-isolation protection for all roles.
-- Only do this in an emergency rollback scenario.
