import { AsyncLocalStorage } from 'node:async_hooks';
import { metrics } from '@opentelemetry/api';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadConfig } from '../config.ts';
import * as schema from './schema.ts';

let pool: Pool | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;
type RootDb = ReturnType<typeof drizzle<typeof schema>>;
type Transaction = Parameters<Parameters<RootDb['transaction']>[0]>[0];
interface TransactionContext {
  tx: Transaction;
  afterCommit: Array<() => void | Promise<void>>;
}
let poolMetricsRegistered = false;
function registerPoolMetrics(): void {
  if (poolMetricsRegistered || process.env.SUNBOLT_OTEL_ENABLED !== 'true') return;
  poolMetricsRegistered = true;
  metrics
    .getMeter('sunbolt')
    .createObservableGauge('sunbolt.db.pool.connections', { unit: '{connection}' })
    .addCallback((result) => {
      if (!pool) return;
      result.observe(pool.totalCount - pool.idleCount, { state: 'active' });
      result.observe(pool.idleCount, { state: 'idle' });
      result.observe(pool.waitingCount, { state: 'waiting' });
    });
}
const ambientTransaction = new AsyncLocalStorage<TransactionContext>();

export function getDb() {
  const current = ambientTransaction.getStore();
  if (current) return current.tx as unknown as RootDb;
  if (dbInstance) return dbInstance;
  const config = loadConfig();
  registerPoolMetrics();
  pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5_000 });
  pool.on('error', () => console.error('idle database connection failed'));
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

/** Run all getDb() calls in fn on one outer transaction so route writes and
 * idempotency outcomes commit or roll back together. */
export async function runInDbTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = ambientTransaction.getStore();
  if (existing) return fn();
  const db = getDb();
  const afterCommit: TransactionContext['afterCommit'] = [];
  const result = await db.transaction((tx) => ambientTransaction.run({ tx, afterCommit }, fn));
  for (const hook of afterCommit) await hook();
  return result;
}

/** Run a nested unit of work in a database savepoint. Post-commit hooks are
 * promoted to the parent only if that savepoint succeeds. */
export async function runInDbSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const parent = ambientTransaction.getStore();
  if (!parent) return runInDbTransaction(fn);
  return parent.tx.transaction(async (tx) => {
    const nested: TransactionContext = { tx, afterCommit: [] };
    const result = await ambientTransaction.run(nested, fn);
    parent.afterCommit.push(...nested.afterCommit);
    return result;
  });
}

export function afterDbCommit(hook: () => void | Promise<void>): void {
  const context = ambientTransaction.getStore();
  if (context) context.afterCommit.push(hook);
  else void hook();
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    dbInstance = undefined;
  }
}

export { schema };
