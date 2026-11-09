import { AsyncLocalStorage } from 'node:async_hooks';
import { metrics } from '@opentelemetry/api';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, escapeLiteral } from 'pg';
import { loadConfig } from '../config.ts';
import { logTelemetryEvent } from '../telemetry.ts';
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
  pool.on('error', () => logTelemetryEvent('db.pool.connection_failed', {}, 'ERROR'));
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

const READ_SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** Spread read work across a single snapshot only when the pool has spare capacity. */
export async function runReadSnapshotWorkers(
  source: Transaction,
  maxWorkers: number,
  work: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const currentPool = pool;
  if (!currentPool || ambientTransaction.getStore() || currentPool.waitingCount > 0) {
    return work(source);
  }
  // A second active connection indicates concurrent traffic. Keep those
  // requests on their own connections instead of competing for worker slots.
  const active = currentPool.totalCount - currentPool.idleCount;
  if (active > 1) return work(source);
  const spare = currentPool.options.max - active - 2;
  const extra = Math.min(maxWorkers - 1, spare);
  if (extra <= 0) return work(source);

  const connections = Array.from({ length: extra }, () => currentPool.connect());
  const snapshot = source
    .execute<{ id: string }>(sql`select pg_export_snapshot() as id`)
    .then(({ rows }) => {
      const [row] = rows;
      if (!row) throw new Error('Missing exported database snapshot');
      return row.id;
    });
  const results = await Promise.allSettled([
    snapshot.then(() => work(source)),
    ...connections.map(async (connection) => {
      const client = await connection;
      try {
        const id = await snapshot;
        await drizzle(client, { schema }).transaction(async (tx) => {
          await tx.execute(sql.raw(`set transaction snapshot ${escapeLiteral(id)}`));
          await work(tx);
        }, READ_SNAPSHOT);
      } finally {
        client.release();
      }
    }),
  ]);
  // The source transaction must outlive every import, including on failure.
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
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
