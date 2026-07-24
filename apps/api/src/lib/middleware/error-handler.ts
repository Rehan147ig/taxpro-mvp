import { Context } from 'hono';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export async function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    c.status(err.statusCode as 400 | 401 | 404 | 500);
    return c.json({
      error: err.message,
      details: err.details,
    });
  }

  logger.error({ err }, 'Unhandled error');
  c.status(500 as const);
  return c.json({ error: 'Internal server error' });
}
