import { Context, Next } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../config/db.js';
import { provisionRuns } from '../../db/schema/provision-runs.js';
import { UnauthorizedError, ForbiddenError, NotFoundError, ConflictError } from '../errors.js';
import { JwtPayload } from './auth.js';

export type Role = 'admin' | 'preparer' | 'reviewer' | 'partner' | 'client_readonly' | 'auditor';

const ROLE_HIERARCHY: Record<Role, number> = {
  client_readonly: 0,
  auditor: 1,
  preparer: 2,
  reviewer: 3,
  partner: 4,
  admin: 5,
};

export function getUser(c: Context): JwtPayload {
  const user = c.get('user') as JwtPayload | undefined;
  if (!user) throw new UnauthorizedError('Authentication required');
  return user;
}

export function requireRole(...roles: Role[]) {
  return (c: Context, next: Next) => {
    const user = getUser(c);
    if (!roles.includes(user.role as Role)) {
      throw new ForbiddenError(`Requires one of roles: ${roles.join(', ')}`);
    }
    return next();
  };
}

export function requireMinimumRole(minRole: Role) {
  return (c: Context, next: Next) => {
    const user = getUser(c);
    const userLevel = ROLE_HIERARCHY[user.role as Role] ?? -1;
    const requiredLevel = ROLE_HIERARCHY[minRole];
    if (userLevel < requiredLevel) {
      throw new ForbiddenError(`Requires at least ${minRole} role`);
    }
    return next();
  };
}

export async function requireRunAccess(runId: string, tenantId: string, tx?: any, forUpdate = false): Promise<{ status: string; approvalStatus: string }> {
  const d = tx ?? db;
  let query = d.select({
    status: provisionRuns.status,
    approvalStatus: provisionRuns.approvalStatus,
    tenantId: provisionRuns.tenantId,
  }).from(provisionRuns).where(eq(provisionRuns.id, runId)).limit(1);
  if (forUpdate && tx) {
    query = query.for('update');
  }
  const [run] = await query;
  if (!run) throw new NotFoundError('Provision run', runId);
  if (run.tenantId !== tenantId) throw new ForbiddenError('Cross-tenant access denied');
  return run;
}

export async function assertRunIsMutable(runId: string, tenantId: string, tx?: any): Promise<void> {
  const run = await requireRunAccess(runId, tenantId, tx, true);
  if (run.status === 'locked') {
    throw new ConflictError('Provision run is locked and cannot be modified');
  }
}

export function canMutate(userRole: string): boolean {
  return !['client_readonly', 'auditor'].includes(userRole);
}

export interface ApprovalRunContext {
  submittedByUserId?: string | null;
  requestedByUserId?: string | null;
}

export function assertPartnerCanApprove(run: ApprovalRunContext, approverUserId: string): void {
  if (run.submittedByUserId === approverUserId) {
    throw new ForbiddenError('A partner cannot approve a run they submitted');
  }
  if (run.requestedByUserId === approverUserId) {
    throw new ForbiddenError('A partner cannot approve a run they requested');
  }
}

export function ensureTenantScoped(userTenantId: string, resourceTenantId: string | null): void {
  if (!resourceTenantId || resourceTenantId !== userTenantId) {
    throw new NotFoundError('Resource');
  }
}