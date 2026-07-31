-- Xero OAuth2 connector storage.
-- Tokens are OAuth bearer tokens; client_secret is the Xero app secret.
-- NOTE: tokens are stored plaintext in this table for the MVP. Move to
-- pgcrypto encryption (or an external KMS) before production multi-tenancy.

CREATE TABLE IF NOT EXISTS xero_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label varchar(255) NOT NULL,
    xero_tenant_id varchar(100) NOT NULL,      -- Xero organisation UUID
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_expires_at timestamptz NOT NULL,
    sync_status varchar(20) DEFAULT 'connected',
    last_synced_at timestamptz,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_connections_tenant ON xero_connections (tenant_id);
