/**
 * Run migrations on a dedicated, direct Postgres connection. Session advisory
 * locking serializes separate migration runners.
 * PgBouncer transaction pooling must not be used for this command.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("set lock_timeout = '60s'");
    await client.query("select pg_advisory_lock(hashtext('gpc:migrations'))");
    await migrate(drizzle(client), { migrationsFolder: 'src/server/db/migrations' });
    console.log('migrations applied');
  } finally {
    // Closing the session releases the lock even if migration/unlock failed.
    client.release(true);
    await pool.end();
  }
}

run().catch((err) => {
  console.error('migration failed', err);
  process.exit(1);
});
