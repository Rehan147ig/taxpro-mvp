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
const MAX_REQUESTS = 100;  // 100 requests per minute

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
  // Skip for health checks
  if (c.req.path === '/health' || c.req.path === '/api/health') {
    return next();
  }

  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';

  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || entry.resetAt < now) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    c.status(429);
    return c.json({
      error: 'Too many requests',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    });
  }

  return next();
}
