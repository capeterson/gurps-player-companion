import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadConfig } from '../config.ts';
import * as schema from './schema.ts';

let pool: Pool | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (dbInstance) return dbInstance;
  const config = loadConfig();
  pool = new Pool({ connectionString: config.databaseUrl });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    dbInstance = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;
export { schema };
