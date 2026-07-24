import { sql } from 'drizzle-orm';
import { db } from '../src/config/db.js';

// Schema is defined in Drizzle ORM schema files. We apply SQL directly
// since drizzle-kit has a CJS/ESM conflict with the .ts schema imports.
const createTables = sql`
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  slug varchar(100) UNIQUE NOT NULL,
  tax_rate decimal(5,4) NOT NULL DEFAULT '0.21',
  state_tax_rate decimal(5,4) DEFAULT '0',
  fiscal_year_end date NOT NULL DEFAULT '2024-12-31',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  role varchar(20) DEFAULT 'user',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id varchar(100) NOT NULL,
  name varchar(255) NOT NULL,
  type varchar(50) NOT NULL,
  currency varchar(10) DEFAULT 'USD',
  is_consolidated boolean DEFAULT false,
  tax_jurisdiction varchar(100) DEFAULT 'US-Federal',
  parent_entity_id uuid,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id varchar(100) NOT NULL,
  account_number varchar(50),
  name varchar(255) NOT NULL,
  type varchar(50) NOT NULL,
  detail_type varchar(100),
  is_summary boolean DEFAULT false,
  parent_id uuid,
  is_inactive boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS trial_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period date NOT NULL,
  period_end date,
  fiscal_year integer,
  fiscal_period integer,
  debit decimal(18,2) DEFAULT '0',
  credit decimal(18,2) DEFAULT '0',
  balance decimal(18,2) DEFAULT '0',
  source varchar(20) DEFAULT 'csv',
  created_at timestamp DEFAULT now(),
  UNIQUE(tenant_id, entity_id, account_id, period, source)
);

CREATE TABLE IF NOT EXISTS tax_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tax_account_type varchar(100) NOT NULL,
  tax_sub_type varchar(100),
  book_treatment varchar(50) NOT NULL,
  timing_category varchar(50),
  confidence_score decimal(3,2),
  suggested_by_ai boolean DEFAULT true,
  override_reason text,
  ai_explanation text,
  is_active boolean DEFAULT true,
  version integer DEFAULT 1,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(tenant_id, account_id, version)
);

CREATE TABLE IF NOT EXISTS provision_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period date NOT NULL,
  status varchar(20) DEFAULT 'draft',
  current_tax_expense decimal(18,2) DEFAULT '0',
  deferred_tax_expense decimal(18,2) DEFAULT '0',
  total_tax_expense decimal(18,2) DEFAULT '0',
  book_income decimal(18,2) DEFAULT '0',
  effective_tax_rate decimal(5,4) DEFAULT '0',
  statutory_rate decimal(5,4) DEFAULT '0',
  tax_payable decimal(18,2) DEFAULT '0',
  valuation_allowance decimal(18,2) DEFAULT '0',
  created_at timestamp DEFAULT now(),
  UNIQUE(tenant_id, period)
);

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label varchar(255) NOT NULL,
  account_id varchar(255) NOT NULL,
  consumer_key text NOT NULL,
  consumer_secret text NOT NULL,
  token_id text NOT NULL,
  token_secret text NOT NULL,
  realm varchar(255) NOT NULL,
  base_url varchar(500) NOT NULL,
  sync_status varchar(20) DEFAULT 'disconnected',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provision_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id),
  period date NOT NULL,
  end_period date,
  entity_id uuid,
  status varchar(40) NOT NULL DEFAULT 'uploaded',
  mode varchar(20) NOT NULL DEFAULT 'direct',
  input_data_hash varchar(128),
  mapping_version_hash varchar(128),
  engine_version varchar(40) NOT NULL DEFAULT 'tax-engine-0.1.0',
  approval_status varchar(30) NOT NULL DEFAULT 'not_required',
  result_id uuid,
  final_output_url text,
  exception_summary text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  finalized_at timestamp
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  provision_run_id uuid REFERENCES provision_runs(id) ON DELETE SET NULL,
  workflow_name varchar(100) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'started',
  provider varchar(50),
  model varchar(100),
  prompt_version varchar(80) NOT NULL DEFAULT 'unversioned',
  input_hash varchar(128),
  input_summary jsonb,
  output_json jsonb,
  error_message text,
  started_at timestamp DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS ai_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  step_name varchar(100) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'started',
  sequence integer NOT NULL DEFAULT 0,
  input_json jsonb,
  output_json jsonb,
  error_message text,
  started_at timestamp DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provision_run_id uuid REFERENCES provision_runs(id) ON DELETE CASCADE,
  item_type varchar(60) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'medium',
  status varchar(30) NOT NULL DEFAULT 'open',
  title varchar(255) NOT NULL,
  description text,
  entity_id uuid,
  account_id uuid,
  source_ref varchar(120),
  confidence_score integer,
  metadata jsonb,
  resolved_by_user_id uuid REFERENCES users(id),
  resolution_note text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  resolved_at timestamp
);

CREATE TABLE IF NOT EXISTS classification_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_name varchar(255) NOT NULL,
  account_number varchar(50),
  account_type varchar(50),
  detail_type varchar(100),
  mapped_type varchar(100) NOT NULL,
  book_treatment varchar(50) NOT NULL,
  timing_category varchar(50),
  resolution varchar(20) NOT NULL DEFAULT 'approved',
  source varchar(20) NOT NULL DEFAULT 'override',
  original_confidence decimal(3,2),
  overridden_from_type varchar(100),
  override_reason text,
  account_name_tokens jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provision_runs_tenant_period ON provision_runs(tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_ai_runs_tenant_workflow ON ai_runs(tenant_id, workflow_name);
CREATE INDEX IF NOT EXISTS idx_review_items_run_status ON review_items(provision_run_id, status);
CREATE INDEX IF NOT EXISTS idx_classification_patterns_tokens ON classification_patterns USING gin(account_name_tokens);
`;

async function main() {
  await db.execute(createTables);
  console.log('[Schema] All tables created successfully');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Schema] Failed:', err);
  process.exit(1);
});
