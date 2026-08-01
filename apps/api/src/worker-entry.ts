import './telemetry.js';
import { env } from './config/env.js';
import { testConnection, closeDb, validateRuntimeRoleSecurity, logSecurityValidation } from './config/db.js';
import { startAllWorkers } from './workers.js';
import { logger } from './lib/logger.js';
import { shutdownTelemetry } from './telemetry.js';

async function main() {
  await testConnection();

  if (env.NODE_ENV !== 'development') {
    const securityResult = await validateRuntimeRoleSecurity();
    logSecurityValidation(securityResult);
    if (!securityResult.valid) {
      logger.error('[Security] Runtime role validation FAILED — refusing to start');
      process.exit(1);
    }
  }

  logger.info({ env: env.NODE_ENV }, '[Worker] Starting background workers');
  const workers = startAllWorkers();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[Worker] Shutdown signal received');
    await workers.closeAll();
    logger.info('[Worker] Workers closed');
    await closeDb();
    await shutdownTelemetry();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, '[Worker] Failed to start');
  process.exit(1);
});
