import './telemetry.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './config/env.js';
import { testConnection, closeDb, validateRuntimeRoleSecurity, logSecurityValidation } from './config/db.js';
import { errorHandler } from './lib/middleware/error-handler.js';
import { rateLimiter } from './lib/middleware/rate-limiter.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { netsuiteRoutes } from './modules/netsuite/netsuite.routes.js';
import { mappingRoutes } from './modules/mapping/mapping.routes.js';
import { provisionRoutes } from './modules/provision/provision.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { startMappingWorker } from './modules/mapping/ai/worker.js';
import { startAutoMappingWorker } from './modules/import/auto-mapping/auto-mapping.worker.js';
import { logger } from './lib/logger.js';
import { shutdownTelemetry } from './telemetry.js';

const app = new Hono();

// ── Global middleware ──
app.use('*', cors({
  origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN,
}));
app.onError(errorHandler);

// Rate limiting — only in production
if (env.NODE_ENV === 'production') {
  app.use('/api/*', rateLimiter);
}

// ── Health check ──
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Status (includes DB connection check) ──
app.get('/api/status', async (c) => {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
    const client = await pool.connect();
    const result = await client.query('SELECT 1 AS ok');
    client.release();
    await pool.end();

    return c.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({
      status: 'degraded',
      database: 'disconnected',
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, 503);
  }
});

// ── Routes ──
app.route('/api/auth', authRoutes);
app.route('/api/netsuite', netsuiteRoutes);
app.route('/api/mapping', mappingRoutes);
app.route('/api/provision', provisionRoutes);
app.route('/api/import', importRoutes);

// ── Start ──
async function main() {
  await testConnection();

  // Validate runtime role security in non-development or when explicitly requested
  if (env.NODE_ENV !== 'development') {
    const securityResult = await validateRuntimeRoleSecurity();
    logSecurityValidation(securityResult);
    if (!securityResult.valid) {
      logger.error('[Security] Runtime role validation FAILED — refusing to start');
      process.exit(1);
    }
  }

  logger.info({ port: env.PORT, env: env.NODE_ENV }, `[API] Starting`);

  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
  });

  // Start background workers
  const mappingWorker = startMappingWorker();
  logger.info('[API] Mapping worker started');

  const autoMappingWorker = startAutoMappingWorker();
  logger.info('[API] Auto-mapping worker started');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[API] Shutdown signal received');
    server.close(async () => {
      logger.info('[API] Server closed');
      await closeDb();
      logger.info('[API] Database pool closed');
      await shutdownTelemetry();
      process.exit(0);
    });

    // Force close after 10s
    setTimeout(() => {
      logger.error('[API] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, '[API] Failed to start');
  process.exit(1);
});

export default app;
