-- Add provision_run_id to provision_results for run-level result ownership
ALTER TABLE provision_results ADD COLUMN IF NOT EXISTS provision_run_id uuid REFERENCES provision_runs(id);

-- Remove the unique constraint on (tenant_id, period) so each run gets its own result
ALTER TABLE provision_results DROP CONSTRAINT IF EXISTS uq_provision_period;
ALTER TABLE provision_results DROP CONSTRAINT IF EXISTS provision_results_tenant_id_period_key;
