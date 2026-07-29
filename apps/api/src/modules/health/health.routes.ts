import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pool } from '../../config/db.js';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const checks: Record<string, boolean> = { db: false, redis: false, rls: false };

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    checks.db = true;

    const rlsRes = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'provision_runs'`,
    );
    checks.rls = rlsRes.rows[0]?.relrowsecurity === true;
    client.release();
  } catch {
    checks.db = false;
  }

  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    const pong = await redis.ping();
    checks.redis = pong === 'PONG';
    await redis.quit();
  } catch {
    checks.redis = false;
  }

  const allOk = checks.db && checks.redis;

  return c.json({
    status: allOk ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
    db: checks.db ? 'connected' : 'disconnected',
    redis: checks.redis ? 'connected' : 'disconnected',
    checks,
  }, allOk ? 200 : 503);
});
