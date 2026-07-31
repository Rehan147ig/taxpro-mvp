import { recordProvisionEvent, EVENT_TYPES } from './provision-events.js';
import { logger } from '../../lib/logger.js';

export interface AuditSensitiveOpInput {
  tenantId: string;
  runId: string;
  action: 'run.locked' | 'run.unlocked' | 'run.finalized' | 'run.unfinalized' | 'role.changed' | 'mapping.overridden' | 'run.posted_to_netsuite';
  actorUserId: string;
  actorRole: string;
  details: Record<string, unknown>;
  requestId?: string;
}

export async function auditSensitiveOp(
  tx: any,
  input: AuditSensitiveOpInput,
): Promise<void> {
  const eventTypeMap: Record<string, string> = {
    'run.locked': EVENT_TYPES.LOCKED,
    'run.unlocked': 'run.unlocked',
    'run.finalized': 'run.finalized',
    'run.unfinalized': 'run.unfinalized',
    'role.changed': 'role.changed',
    'mapping.overridden': EVENT_TYPES.MAPPING_OVERRIDE,
    'run.posted_to_netsuite': EVENT_TYPES.POSTED_TO_NETSUITE,
  };

  const eventType = eventTypeMap[input.action] ?? input.action;

  const payload: Record<string, unknown> = {
    ...input.details,
    actorRole: input.actorRole,
  };
  if (input.requestId) {
    payload.requestId = input.requestId;
  }

  await recordProvisionEvent({
    tenantId: input.tenantId,
    provisionRunId: input.runId,
    eventType,
    actorType: 'user',
    actorUserId: input.actorUserId,
    reason: `${input.action} by ${input.actorRole}`,
    metadata: payload,
  }, tx);

  logger.info({
    audit: true,
    action: input.action,
    tenantId: input.tenantId,
    runId: input.runId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    details: input.details,
    requestId: input.requestId,
  }, `[AUDIT] action=${input.action} tenant=${input.tenantId} run=${input.runId} actor=${input.actorUserId}`);
}
