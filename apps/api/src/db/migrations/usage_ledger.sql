-- Usage/billing metering for per-provision pricing.
-- Append-only: each completed provision run records a usage event with a
-- unit price snapshotted at run time (pricing changes never rewrite history).

CREATE TABLE IF NOT EXISTS usage_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type varchar(50) NOT NULL,          -- 'provision_completed'
    provision_run_id uuid REFERENCES provision_runs(id),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    quantity numeric(12, 4) NOT NULL DEFAULT 1,
    unit_price numeric(12, 2) NOT NULL,       -- price per unit at time of use
    amount numeric(12, 2) NOT NULL,
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_period
    ON usage_events (tenant_id, occurred_at);
