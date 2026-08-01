-- ================================================================
-- Phase 3.6: Database Role Bootstrap
-- ================================================================
-- Run this as a PostgreSQL superuser or a role with CREATEROLE + CREATEDB
-- to set up the schema_owner and app_tenant roles.
--
-- Usage:
--   psql -U postgres -d taxpro -f scripts/bootstrap-roles.sql
--
-- After running, set these environment variables:
--   DATABASE_URL_MIGRATIONS=postgres://taxpro_migrations:<password>@localhost:5432/taxpro
--   DATABASE_URL=postgres://taxpro_app:<password>@localhost:5432/taxpro
-- The runtime pool (db.ts) uses DATABASE_URL (taxpro_app, NOBYPASSRLS).
-- The migration pool uses DATABASE_URL_MIGRATIONS (schema_owner).
-- ================================================================

-- ================================================================
-- Step 1: Create the schema_owner role (migrations)
-- ================================================================
-- This role owns all tenant tables and runs Drizzle migrations.
-- It is NOT used by the API runtime or workers.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_migrations') THEN
    CREATE ROLE taxpro_migrations WITH LOGIN PASSWORD 'change-me-migrations-password' CREATEDB;
    COMMENT ON ROLE taxpro_migrations IS 'Schema owner for TaxPro migrations. Not used at runtime.';
  END IF;
END $$;

-- ================================================================
-- Step 2: Create the app_tenant runtime role
-- ================================================================
-- This is the role used by the API server and background workers at runtime.
-- NOBYPASSRLS ensures Row-Level Security policies are always enforced.
-- Does NOT own any tables.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'taxpro_app') THEN
    CREATE ROLE taxpro_app WITH LOGIN PASSWORD 'change-me-app-password' NOBYPASSRLS;
    COMMENT ON ROLE taxpro_app IS 'Runtime API/worker role with NOBYPASSRLS. Tenant isolation enforced via RLS.';
  END IF;
END $$;

-- ================================================================
-- Step 3: Grant schema usage
-- ================================================================

GRANT USAGE ON SCHEMA public TO taxpro_app;

-- ================================================================
-- Step 3.5: Grant the schema owner creation rights
-- ================================================================
-- The migrations role must be able to create the drizzle bookkeeping
-- schema (requires CREATE on the database) and tables in the public
-- schema (PG15+ restricts public-schema CREATE to the database owner).
-- Database name is taken from current_database() so this works in any
-- dev/test/prod database.

DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO taxpro_migrations', current_database());
  EXECUTE 'GRANT CREATE ON SCHEMA public TO taxpro_migrations';
END $$;

-- ================================================================
-- Step 4: Grant table-level privileges to app_tenant
-- ================================================================
-- Full CRUD on tenant-owned tables that the app needs to modify.
-- SELECT-only on tables that are read-only for the app.
-- No UPDATE/DELETE on provision_events (append-only).
--
-- Tolerant of a fresh database: table grants are skipped when the table
-- does not exist yet (e.g. when this script runs at container initdb,
-- before migrations). The same grants are re-applied after migration by
-- src/db/migrate.ts, which also enforces the provision_events restriction
-- on top of the blanket ALTER DEFAULT PRIVILEGES below.

DO $$ DECLARE
  t text;
  full_access_tables text[] := ARRAY[
    'tenants', 'provision_runs', 'provision_results',
    'review_items', 'tax_mappings', 'trial_balance',
    'accounts', 'entities', 'ai_runs', 'ai_steps',
    'classification_patterns', 'connections', 'users', 'usage_events'
  ];
BEGIN
  FOREACH t IN ARRAY full_access_tables
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO taxpro_app;', t);
    END IF;
  END LOOP;
END $$;

-- provision_events: SELECT and INSERT only
DO $$
BEGIN
  IF to_regclass('provision_events') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT ON provision_events TO taxpro_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON provision_events FROM taxpro_app';
  END IF;
END $$;

-- Schema-level defaults for future tables
ALTER DEFAULT PRIVILEGES FOR ROLE taxpro_migrations IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taxpro_app;

-- ================================================================
-- Step 5: Grant sequence privileges (for any serial columns)
-- ================================================================

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taxpro_app;
ALTER DEFAULT PRIVILEGES FOR ROLE taxpro_migrations IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO taxpro_app;

-- ================================================================
-- Step 6: Verify setup
-- ================================================================
-- Run after the migration:
--   SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname LIKE 'taxpro_%';
--   \dp provision_runs
--   \du taxpro_app
-- ================================================================

-- ================================================================
-- Step 7: Make schema_owner the owner of existing tables
-- ================================================================
-- This must be done AFTER running the 0004 migration.
-- Uncomment and run after verifying:
--
-- DO $$ DECLARE
--   t text;
--   tables text[] := ARRAY[
--     'provision_runs', 'provision_results', 'provision_events',
--     'review_items', 'tax_mappings', 'trial_balance',
--     'accounts', 'entities', 'ai_runs', 'ai_steps',
--     'classification_patterns', 'connections', 'users',
--     'tenants', '__drizzle_migrations'
--   ];
-- BEGIN
--   FOREACH t IN ARRAY tables
--   LOOP
--     EXECUTE format('ALTER TABLE %I OWNER TO taxpro_migrations;', t);
--   END LOOP;
-- END $$;
--
-- ================================================================

-- ================================================================
-- ROLLBACK
-- ================================================================
-- To revert role setup:
--   REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM taxpro_app;
--   REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM taxpro_app;
--   REVOKE USAGE ON SCHEMA public FROM taxpro_app;
--   DROP ROLE IF EXISTS taxpro_app;
--   DROP ROLE IF EXISTS taxpro_migrations;
-- ================================================================
