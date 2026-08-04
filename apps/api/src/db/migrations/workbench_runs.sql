-- ================================================================
-- 0014 — Phase C: UK Tax-Close Workbench
--
-- Extends provision_runs with the workbench run contract:
--   * evidence provenance (source document, accounting/tax periods)
--   * version lineage (parent run id for recalculation-as-new-version)
--   * deterministic snapshots (mapping snapshot, assumptions, warnings)
--   * traceability (correlation id) and idempotency (idempotency key)
-- Links trial_balance rows to their source document, and adds the
-- workbench job ledger used for idempotent import/calculation jobs.
-- ================================================================

ALTER TABLE provision_runs
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_period_id uuid REFERENCES accounting_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_period_id uuid REFERENCES tax_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES provision_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS assumptions jsonb,
  ADD COLUMN IF NOT EXISTS warnings jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id varchar(64),
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(128);

-- Idempotency: the same tenant may never create two runs with the same key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provision_runs_tenant_idempotency_key
  ON provision_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Trial balance rows know which immutable artefact they were imported from.
ALTER TABLE trial_balance
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trial_balance_source_document ON trial_balance (source_document_id);

-- ================================================================
-- Workbench job ledger (idempotent, tenant-scoped, auditable)
-- ================================================================

CREATE TABLE IF NOT EXISTS workbench_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type varchar(40) NOT NULL,                 -- trial_balance_import | provision_calculation | provision_recalculation
  idempotency_key varchar(128) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',  -- queued|running|succeeded|failed
  payload jsonb NOT NULL,
  result jsonb,
  error_text text,
  correlation_id varchar(64),
  provision_run_id uuid REFERENCES provision_runs(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  started_at timestamp,
  completed_at timestamp,
  CONSTRAINT uq_workbench_jobs_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_workbench_jobs_tenant_status ON workbench_jobs (tenant_id, status);

-- ================================================================
-- RLS — strict default-deny, same tenant_isolation_* convention
-- ================================================================

ALTER TABLE workbench_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON workbench_jobs;
CREATE POLICY tenant_isolation_select ON workbench_jobs FOR SELECT
  USING (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_insert ON workbench_jobs;
CREATE POLICY tenant_isolation_insert ON workbench_jobs FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_update ON workbench_jobs;
CREATE POLICY tenant_isolation_update ON workbench_jobs FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- ================================================================
-- Runtime role privileges
-- ================================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workbench_jobs TO taxpro_app;
    REVOKE DELETE, TRUNCATE ON workbench_jobs FROM taxpro_app;
  END IF;
END $$;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert this migration:
--   1. DROP TABLE IF EXISTS workbench_jobs;
--   2. ALTER TABLE trial_balance DROP COLUMN IF EXISTS source_document_id;
--   3. ALTER TABLE provision_runs
--        DROP COLUMN IF EXISTS source_document_id,
--        DROP COLUMN IF EXISTS accounting_period_id,
--        DROP COLUMN IF EXISTS tax_period_id,
--        DROP COLUMN IF EXISTS parent_run_id,
--        DROP COLUMN IF EXISTS mapping_snapshot,
--        DROP COLUMN IF EXISTS assumptions,
--        DROP COLUMN IF EXISTS warnings,
--        DROP COLUMN IF EXISTS correlation_id,
--        DROP COLUMN IF EXISTS idempotency_key;
--   4. DROP INDEX IF EXISTS uq_provision_runs_tenant_idempotency_key;
--   5. DROP INDEX IF EXISTS idx_trial_balance_source_document;
