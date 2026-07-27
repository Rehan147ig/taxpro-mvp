import { withTenantContext } from '../../config/db.js';
import { ForbiddenError } from '../errors.js';
import type { Context } from 'hono';

type TxDb = Awaited<ReturnType<typeof withTenantContext<any>>> extends infer R
  ? R extends Promise<infer T> ? T : never
  : never;

type Handler = (c: Context, tx: any) => Response | Promise<Response>;

export function tenantHandler(handler: Handler) {
  return async (c: Context) => {
    const user = c.get('user');
    if (!user?.tenantId) throw new ForbiddenError('No tenant context');
    return withTenantContext(user.tenantId, async (tx) => {
      return handler(c, tx);
    });
  };
}
