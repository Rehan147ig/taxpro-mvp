-- QuickBooks Online OAuth2 connector storage (same hardening notes as xero_connections).

CREATE TABLE IF NOT EXISTS qbo_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label varchar(255) NOT NULL,
    realm_id varchar(100) NOT NULL,              -- QBO company id
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_expires_at timestamptz NOT NULL,
    sync_status varchar(20) DEFAULT 'connected',
    last_synced_at timestamptz,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qbo_connections_tenant ON qbo_connections (tenant_id);
