import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env'), override: true });
import { z } from 'zod';

const envSchema = z.object({
  // Runtime database connection (non-owner NOBYPASSRLS role)
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/taxpro'),
  // Migration database connection (schema owner role — separate from runtime)
  DATABASE_URL_MIGRATIONS: z.string().default('postgres://postgres:postgres@localhost:5432/taxpro'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().default('dev-secret-change-in-production'),
  DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // AI Provider — swap by changing these
  AI_PROVIDER: z.enum(['openai', 'nvidia', 'custom']).default('openai'),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),

  // Legacy fallback
  OPENAI_API_KEY: z.string().optional(),

  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET === 'dev-secret-change-in-production' || env.JWT_SECRET === 'change-me-in-production') {
    throw new Error('JWT_SECRET must be set to a strong secret in production');
  }
}
