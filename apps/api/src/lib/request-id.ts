import { Context, Next } from 'hono';
import crypto from 'crypto';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export async function requestIdMiddleware(c: Context, next: Next) {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  await next();
}
