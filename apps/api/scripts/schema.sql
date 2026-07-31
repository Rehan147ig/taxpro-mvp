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
  placed_in_service_date date,
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
  placed_in_service_date date,
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
  detail jsonb,
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

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type varchar(50) NOT NULL,
  provision_run_id uuid REFERENCES provision_runs(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  quantity numeric(12,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  metadata jsonb
);
