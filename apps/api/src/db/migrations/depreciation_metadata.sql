-- Depreciation asset metadata (Phase 4): placed-in-service date on accounts and trial balance.
-- Idempotent; safe to re-run. Applied manually to existing databases (same pattern as add_mapping_status.sql).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS placed_in_service_date date;
ALTER TABLE trial_balance ADD COLUMN IF NOT EXISTS placed_in_service_date date;
