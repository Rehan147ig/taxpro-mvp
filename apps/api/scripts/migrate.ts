import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../src/config/env.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('[Migrate] Done');
  await pool.end();
}

main().catch((err) => {
  console.error('[Migrate] Failed', err);
  process.exit(1);
});
