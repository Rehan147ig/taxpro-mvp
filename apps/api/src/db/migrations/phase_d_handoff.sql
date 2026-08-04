-- ================================================================
-- 0016 — Phase D: External Filing Handoff
--
-- Extends provision_runs with the filing-handoff contract:
--   * handoff_ready_at / handoff_ready_by_user_id — filing-ready handoff
--     state entered only by an authorised user on a locked run
--   * filed_externally_at / filed_externally_by_user_id — external filing
--     recorded only by an authorised user, after a real external event
-- Adds the external_filings ledger: append-only records of EXTERNAL filing
-- events. TaxPro never submits to HMRC — every row records a filing that
-- happened OUTSIDE TaxPro (agent software / HMRC gateway / paper), entered
-- manually with the source reference, and tied to the exported manifest
-- checksum of the package the accountant took to filing.
-- ================================================================

ALTER TABLE provision_runs
  ADD COLUMN IF NOT EXISTS handoff_ready_at timestamp,
  ADD COLUMN IF NOT EXISTS handoff_ready_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS filed_externally_at timestamp,
  ADD COLUMN IF NOT EXISTS filed_externally_by_user_id uuid REFERENCES users(id);

-- Maker-checker: when enabled on a tenant, approval/lock/handoff/filing
-- transitions must be performed by a user other than the one who created
-- the run (or prepared it). Off by default; existing tenants unaffected.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS maker_checker_enabled boolean NOT NULL DEFAULT false;

-- ================================================================
-- External filing ledger (append-only, tenant-scoped, auditable)
-- ================================================================

CREATE TABLE IF NOT EXISTS external_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES provision_runs(id),
  filing_provider varchar(80) NOT NULL,          -- IRIS | Digita | TaxCalc | HMRC gateway | Paper, etc.
  filing_reference varchar(120) NOT NULL,        -- external acknowledgement / submission reference
  submitted_date date NOT NULL,
  recorded_by_user_id uuid REFERENCES users(id),
  confirmation_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  confirmation_document_hash varchar(64),
  manifest_checksum varchar(64) NOT NULL,        -- sha256 of the manifest exported with the package
  supersedes_filing_id uuid REFERENCES external_filings(id),  -- corrections create a NEW record
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_filings_tenant_run ON external_filings (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_external_filings_tenant ON external_filings (tenant_id);

-- Append-only ledger: updates and deletes are rejected outright (any role,
-- including table owner) — a correction is a NEW record that supersedes.
CREATE OR REPLACE FUNCTION prevent_external_filings_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'external_filings is append-only: UPDATE/DELETE are not permitted; record a new filing (supersedes_filing_id) to correct an entry';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_external_filings_append_only ON external_filings;
CREATE TRIGGER trg_external_filings_append_only
  BEFORE UPDATE OR DELETE ON external_filings
  FOR EACH ROW EXECUTE FUNCTION prevent_external_filings_mutation();

-- ================================================================
-- RLS — strict default-deny, same tenant_isolation_* convention
-- ================================================================

ALTER TABLE external_filings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON external_filings;
CREATE POLICY tenant_isolation_select ON external_filings FOR SELECT
  USING (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_insert ON external_filings;
CREATE POLICY tenant_isolation_insert ON external_filings FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

-- No UPDATE / DELETE policies: RLS denies mutation for non-owner roles.

-- ================================================================
-- Runtime role privileges
-- ================================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_app') THEN
    GRANT SELECT, INSERT ON external_filings TO taxpro_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON external_filings FROM taxpro_app;
  END IF;
END $$;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert this migration:
--   1. DROP TABLE IF EXISTS external_filings;
--   2. DROP FUNCTION IF EXISTS prevent_external_filings_mutation();
--   3. ALTER TABLE tenants DROP COLUMN IF EXISTS maker_checker_enabled;
--   4. ALTER TABLE provision_runs
--        DROP COLUMN IF EXISTS handoff_ready_at,
--        DROP COLUMN IF EXISTS handoff_ready_by_user_id,
--        DROP COLUMN IF EXISTS filed_externally_at,
--        DROP COLUMN IF EXISTS filed_externally_by_user_id;
--   5. DELETE FROM __drizzle_migrations WHERE id = 16;
