import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Works from both src (tsx dev) and dist (container runtime)
const migrationsFolder = resolve(__dirname, '../../src/db/migrations');

const pool = new pg.Pool({ connectionString: env.DATABASE_URL_MIGRATIONS });
const db = drizzle(pool);

async function main() {
  console.log('[Migration] Running versioned migrations from:', migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log('[Migration] Migrations applied successfully');
  await pool.end();
}

main().catch((err) => {
  console.error('[Migration] Failed', err);
  process.exit(1);
});
