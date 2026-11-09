/**
 * Run migrations on a dedicated, direct Postgres connection. Session advisory
 * locking serializes separate migration runners.
 * PgBouncer transaction pooling must not be used for this command.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { logTelemetryEvent, startTelemetry, stopTelemetry } from '../telemetry.ts';

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("set lock_timeout = '60s'");
    await client.query("select pg_advisory_lock(hashtext('gpc:migrations'))");
    await migrate(drizzle(client), { migrationsFolder: 'src/server/db/migrations' });
    logTelemetryEvent('db.migration.completed', {});
  } finally {
    // Closing the session releases the lock even if migration/unlock failed.
    client.release(true);
    await pool.end();
  }
}

startTelemetry();
logTelemetryEvent('db.migration.started', {});
try {
  await run();
} catch {
  logTelemetryEvent('db.migration.failed', {}, 'ERROR');
  process.exitCode = 1;
} finally {
  await stopTelemetry().catch(() => undefined);
}
