-- Phase 3: Governance, RBAC, and Control Foundations

-- 1. Canonical approval/lock timestamps on provision_runs
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS submitted_at timestamp;
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES users(id);
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS approved_at timestamp;
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS locked_at timestamp;
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS locked_by_user_id uuid REFERENCES users(id);
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS rejected_at timestamp;
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid REFERENCES users(id);
ALTER TABLE provision_runs ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 2. Append-only provision event trail
CREATE TABLE IF NOT EXISTS provision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provision_run_id uuid NOT NULL REFERENCES provision_runs(id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL,
  actor_type varchar(20) NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  actor_agent_id uuid,
  occurred_at timestamp NOT NULL DEFAULT now(),
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provision_events_run ON provision_events(provision_run_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_provision_events_tenant ON provision_events(tenant_id, event_type);

-- 3. AI trace: add policy outcome fields to ai_runs
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS policy_outcome varchar(20) DEFAULT 'allowed';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS tool_name varchar(100);
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS agent_name varchar(100);

-- Backfill policy: no backfill for approval/lock timestamps (we cannot know who approved historically).
-- Historical records will show null for these fields, which the UI renders as "Approval history unavailable".

-- Rollback notes:
-- To revert this migration:
--   DROP TABLE IF EXISTS provision_events;
--   ALTER TABLE provision_runs DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS submitted_by_user_id, DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS locked_by_user_id, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS rejected_by_user_id, DROP COLUMN IF EXISTS rejection_reason;
--   ALTER TABLE ai_runs DROP COLUMN IF EXISTS policy_outcome, DROP COLUMN IF EXISTS tool_name, DROP COLUMN IF EXISTS agent_name;