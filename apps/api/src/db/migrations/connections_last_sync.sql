-- Schema drift fix: the Drizzle `connections` schema declares `last_sync_at`
-- and `sync_status` (default 'idle'), but the original `connections` table
-- (initial_schema.sql) never received `last_sync_at` and defaulted
-- `sync_status` to 'disconnected'. Align the table with the schema so the
-- NetSuite connections surface (and the dashboard's data-source card) work.

ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_sync_at timestamp;
ALTER TABLE connections ALTER COLUMN sync_status SET DEFAULT 'idle';
