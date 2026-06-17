/**
 * withAudit: run a DB operation inside a transaction that first sets
 * the Postgres session-local GUCs app.actor_id and app.batch_id.
 *
 * WHY this must be transaction-local:
 *   getDb() returns a Drizzle instance backed by a pg.Pool.  A bare
 *   getDb().update(...) checks out an arbitrary pooled connection for
 *   one statement and returns it immediately.  A SET that runs on a
 *   different checkout is invisible to the write (wrong connection) or,
 *   if using a non-LOCAL SET, leaks the actor id onto the next request
 *   that reuses the same connection.  SET LOCAL only persists for the
 *   duration of the transaction, which is exactly what we need.
 *
 * Usage:
 *   const row = await withAudit(userId, batchId, (tx) =>
 *     tx.update(characters).set({...}).where(...).returning()
 *   );
 */

import { sql } from 'drizzle-orm';
import { getDb } from './client.ts';

// Derive the transaction type from the actual schema-typed database that
// getDb() returns. Deriving it from a bare NodePgDatabase (schema =
// Record<string, never>) makes the tx passed to fn unassignable under
// exactOptionalPropertyTypes.
type AuditDb = ReturnType<typeof getDb>;
export type AuditTx = Parameters<Parameters<AuditDb['transaction']>[0]>[0];

export async function withAudit<T>(
  actorId: string,
  batchId: string | null | undefined,
  fn: (tx: AuditTx) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
    await tx.execute(sql`select set_config('app.batch_id', ${batchId ?? ''}, true)`);
    return fn(tx);
  });
}
