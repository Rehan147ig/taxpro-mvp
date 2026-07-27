import { pgTable, uuid, varchar, timestamp, text, jsonb, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { provisionRuns } from './provision-runs.js';

export const aiRuns = pgTable('ai_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  provisionRunId: uuid('provision_run_id').references(() => provisionRuns.id, { onDelete: 'set null' }),
  workflowName: varchar('workflow_name', { length: 100 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('started'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  promptVersion: varchar('prompt_version', { length: 80 }).notNull().default('unversioned'),
  inputHash: varchar('input_hash', { length: 128 }),
  inputSummary: jsonb('input_summary'),
  outputJson: jsonb('output_json'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  policyOutcome: varchar('policy_outcome', { length: 20 }).default('allowed'),
  toolName: varchar('tool_name', { length: 100 }),
  agentName: varchar('agent_name', { length: 100 }),
});

export const aiSteps = pgTable('ai_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  aiRunId: uuid('ai_run_id').notNull().references(() => aiRuns.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  stepName: varchar('step_name', { length: 100 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('started'),
  sequence: integer('sequence').notNull().default(0),
  inputJson: jsonb('input_json'),
  outputJson: jsonb('output_json'),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});
