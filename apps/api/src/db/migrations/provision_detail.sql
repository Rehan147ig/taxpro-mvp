-- Add detail JSONB column to provision_results for full calculation output
-- (currentTax breakdown, deferred tax lines, ETR recon lines, rollforward,
-- journal entries). Enables truthful workpaper export with real line items.

ALTER TABLE provision_results ADD COLUMN IF NOT EXISTS detail jsonb;

CREATE INDEX IF NOT EXISTS idx_provision_results_period ON provision_results (period);
