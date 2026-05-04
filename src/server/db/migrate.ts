/**
 * Apply Drizzle migrations against the configured Postgres database.
 * Used by the dev compose entrypoint and production startup script.
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client.ts';

async function run(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: 'src/server/db/migrations' });
  console.log('migrations applied');
  await closeDb();
}

run().catch((err) => {
  console.error('migration failed', err);
  process.exit(1);
});
