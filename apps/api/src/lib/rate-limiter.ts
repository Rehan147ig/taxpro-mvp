import { Context, Next } from 'hono';

interface RateEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateEntry>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;
  if (entry.count > MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    c.status(429);
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: `Too many requests. Try again in ${retryAfter} seconds.` });
  }

  return next();
}
