import { Context, Next } from 'hono';

/**
 * Simple in-memory rate limiter.
 *
 * In production, replace with a Redis-backed implementation (e.g., via BullMQ).
 * For the MVP, this prevents basic abuse without external dependencies.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000; // 1 minute
// 100 requests per minute in production. Development/CI runs (E2E suites,
// seeded demo flows) legitimately exceed that budget, so dev defaults are
// far higher unless overridden. Resolved lazily so test processes can pin
// production bounds without reimports.
export function apiMaxRequests() {
  return Number(process.env.API_RATE_LIMIT_MAX ?? (process.env.NODE_ENV === 'development' ? 1000 : 100));
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
// Use unref() so this timer doesn't prevent Node from exiting
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 300_000).unref();

export async function rateLimiter(c: Context, next: Next) {
  return createRateLimiter('api', apiMaxRequests(), WINDOW_MS)(c, next);
}

export function createRateLimiter(scope: string, maxRequests: number, windowMs: number) {
  const scopeStore = scope === 'api' ? store : new Map<string, RateLimitEntry>();
  return async (c: Context, next: Next) => {
    if (c.req.path === '/health' || c.req.path === '/api/health') {
      return next();
    }

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';

    const now = Date.now();
    const entry = scopeStore.get(ip);

    if (!entry || entry.resetAt < now) {
      scopeStore.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      c.status(429);
      return c.json({
        error: 'Too many requests',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    return next();
  };
}

export const strictRateLimiter = createRateLimiter('provision', 20, 60_000);
