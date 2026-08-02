-- ================================================================
-- 0012: provision_runs approval column (schema drift fix)
-- ================================================================
-- The TypeScript schema (src/db/schema/provision-runs.ts) defines
-- approvedByUserId but no migration ever created the column — so a
-- fresh database (CI, staging, prod) lacked it while dev databases
-- that were altered manually had it. Add it to match the schema.
-- ================================================================

ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES users(id);
