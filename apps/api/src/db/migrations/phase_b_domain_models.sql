-- Phase B: UK Domain Model and Data Foundations
-- entity groups, accounting/tax periods, source-document artefact store,
-- mapping proposals, rule registry, review-item lifecycle extension,
-- append-only review decision history, and RLS coverage for connector tables.
--
-- Conventions follow the existing migrations: idempotent (IF NOT EXISTS),
-- strict default-deny RLS via app_current_tenant_id(), rollback notes at bottom.

-- ================================================================
-- 1. Entity groups + group link on entities
-- ================================================================

CREATE TABLE IF NOT EXISTS entity_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  description text,
  parent_group_id uuid REFERENCES entity_groups(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_groups_tenant ON entity_groups(tenant_id);

ALTER TABLE entities ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES entity_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_entities_group ON entities(group_id);

-- ================================================================
-- 2. Accounting periods (book) and tax periods (corporation tax)
-- ================================================================

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  period_type varchar(20) NOT NULL DEFAULT 'annual', -- monthly|quarterly|annual|other
  status varchar(20) NOT NULL DEFAULT 'open',        -- open|closed|archived
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_periods_tenant_entity_dates
  ON accounting_periods(tenant_id, entity_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS tax_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  accounting_period_id uuid REFERENCES accounting_periods(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  duration_months integer NOT NULL,
  is_standard_duration boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'draft', -- draft|open|in_progress|needs_review|closed|locked
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_periods_tenant_entity_dates
  ON tax_periods(tenant_id, entity_id, start_date, end_date);

-- ================================================================
-- 3. Source-document artefact store (metadata only, no blobs in Postgres)
-- ================================================================

CREATE TABLE IF NOT EXISTS source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  accounting_period_id uuid REFERENCES accounting_periods(id) ON DELETE SET NULL,
  tax_period_id uuid REFERENCES tax_periods(id) ON DELETE SET NULL,
  document_type varchar(60) NOT NULL, -- trial_balance|prior_year_tax_computation|ct600|workpaper|fixed_asset_schedule|loss_schedule|supporting_pdf|other
  filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key varchar(255) NOT NULL,
  sha256 varchar(64) NOT NULL,
  provenance varchar(60) NOT NULL DEFAULT 'manual_upload', -- xero|qbo|csv_import|interfaze|manual_upload
  extraction_status varchar(30) NOT NULL DEFAULT 'not_required', -- pending|extracted|failed|not_required
  extraction_version varchar(40),
  version integer NOT NULL DEFAULT 1,
  parent_document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  is_current boolean NOT NULL DEFAULT true,
  uploaded_by_user_id uuid REFERENCES users(id),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_documents_tenant ON source_documents(tenant_id, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_documents_tenant_storage_key ON source_documents(tenant_id, storage_key);

-- ================================================================
-- 4. Mapping proposals (AI proposes, humans decide)
-- ================================================================

CREATE TABLE IF NOT EXISTS mapping_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  source_account_external_id varchar(100) NOT NULL,
  source_account_name varchar(255),
  target_tax_classification varchar(100) NOT NULL,
  book_treatment varchar(50) NOT NULL,
  timing_category varchar(50),
  confidence_score numeric(5,4),
  proposal_source varchar(30) NOT NULL, -- ai|rules|manual|import|carry_forward
  status varchar(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|superseded
  reviewer_user_id uuid REFERENCES users(id),
  reviewer_decision varchar(30),
  decision_reason text,
  decided_at timestamp,
  version integer NOT NULL DEFAULT 1,
  carries_forward boolean NOT NULL DEFAULT false,
  prior_mapping_id uuid REFERENCES tax_mappings(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mapping_proposals_tenant_status ON mapping_proposals(tenant_id, status);

-- ================================================================
-- 5. UK rule registry (rate/regime rules with provenance + approval)
-- ================================================================

CREATE TABLE IF NOT EXISTS uk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_key varchar(100) NOT NULL,
  jurisdiction varchar(30) NOT NULL DEFAULT 'UK_FRS102',
  effective_from date NOT NULL,
  effective_to date,
  source_url varchar(500),
  source_snapshot_hash varchar(64),
  author varchar(255),
  approval_state varchar(20) NOT NULL DEFAULT 'proposal', -- proposal|approved|superseded|rolled_back
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamp,
  version integer NOT NULL DEFAULT 1,
  test_fixture_ref varchar(255),
  change_rationale text,
  supersedes_rule_id uuid REFERENCES uk_rules(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT uq_uk_rules_tenant_key_version UNIQUE (tenant_id, rule_key, version)
);

CREATE INDEX IF NOT EXISTS idx_uk_rules_tenant ON uk_rules(tenant_id, jurisdiction);

-- ================================================================
-- 6. Review-item lifecycle extension
-- ================================================================

ALTER TABLE review_items ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id);
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS evidence_requested text;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES source_documents(id) ON DELETE SET NULL;

-- Immutable decision history for review items
CREATE TABLE IF NOT EXISTS review_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  review_item_id uuid NOT NULL REFERENCES review_items(id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL, -- created|status_changed|evidence_requested|evidence_submitted|commented|resolved|waived|reopened
  actor_user_id uuid REFERENCES users(id),
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_item_events_item ON review_item_events(review_item_id, created_at);

-- Append-only protection (same pattern as provision_events)
CREATE OR REPLACE FUNCTION reject_review_item_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'review_item_events are append-only and cannot be modified or deleted'
      USING HINT = 'Events are immutable records. Insert a new event instead.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'review_item_events are append-only and cannot be modified or deleted'
      USING HINT = 'Events are immutable records and cannot be removed.';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS review_item_events_append_only ON review_item_events;
CREATE TRIGGER review_item_events_append_only
  BEFORE UPDATE OR DELETE ON review_item_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_review_item_event_mutation();

-- ================================================================
-- 7. Provision runs record exactly which rule versions they used
-- ================================================================

ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS rules_used jsonb;

-- ================================================================
-- 8. RLS — strict default-deny on every new tenant-owned table
-- ================================================================

DO $$
DECLARE
  tables text[] := ARRAY[
    'entity_groups', 'accounting_periods', 'tax_periods',
    'source_documents', 'mapping_proposals', 'uk_rules'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = app_current_tenant_id());', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = app_current_tenant_id());', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I;', t);
    EXECUTE format('CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = app_current_tenant_id());', t);
  END LOOP;
END $$;

-- review_item_events: SELECT + INSERT only
ALTER TABLE review_item_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON review_item_events;
CREATE POLICY tenant_isolation_select ON review_item_events FOR SELECT
  USING (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON review_item_events;
CREATE POLICY tenant_isolation_insert ON review_item_events FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());

-- connector tables were created before RLS hardening and were never covered
ALTER TABLE qbo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE xero_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON qbo_connections;
CREATE POLICY tenant_isolation_select ON qbo_connections FOR SELECT
  USING (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON qbo_connections;
CREATE POLICY tenant_isolation_insert ON qbo_connections FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_update ON qbo_connections;
CREATE POLICY tenant_isolation_update ON qbo_connections FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_delete ON qbo_connections;
CREATE POLICY tenant_isolation_delete ON qbo_connections FOR DELETE
  USING (tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation_select ON xero_connections;
CREATE POLICY tenant_isolation_select ON xero_connections FOR SELECT
  USING (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_insert ON xero_connections;
CREATE POLICY tenant_isolation_insert ON xero_connections FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_update ON xero_connections;
CREATE POLICY tenant_isolation_update ON xero_connections FOR UPDATE
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
DROP POLICY IF EXISTS tenant_isolation_delete ON xero_connections;
CREATE POLICY tenant_isolation_delete ON xero_connections FOR DELETE
  USING (tenant_id = app_current_tenant_id());

-- ================================================================
-- 9. Runtime role privileges (append-only restriction on review_item_events)
-- ================================================================

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      entity_groups, accounting_periods, tax_periods,
      source_documents, mapping_proposals, uk_rules,
      qbo_connections, xero_connections
    TO taxpro_app;

    GRANT SELECT, INSERT ON review_item_events TO taxpro_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON review_item_events FROM taxpro_app;
  END IF;
END $$;

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert this migration:
--   1. DROP TRIGGER IF EXISTS review_item_events_append_only ON review_item_events;
--   2. DROP FUNCTION IF EXISTS reject_review_item_event_mutation();
--   3. DROP TABLE IF EXISTS review_item_events, uk_rules, mapping_proposals,
--      source_documents, tax_periods, accounting_periods, entity_groups;
--   4. ALTER TABLE provision_runs DROP COLUMN IF EXISTS rules_used;
--   5. ALTER TABLE review_items DROP COLUMN IF EXISTS owner_user_id,
--      DROP COLUMN IF EXISTS due_date, DROP COLUMN IF EXISTS evidence_requested,
--      DROP COLUMN IF EXISTS document_id;
--   6. ALTER TABLE entities DROP COLUMN IF EXISTS group_id;
--   7. ALTER TABLE qbo_connections DISABLE ROW LEVEL SECURITY;
--      ALTER TABLE xero_connections DISABLE ROW LEVEL SECURITY;
--      (drop their tenant_isolation_* policies too)
