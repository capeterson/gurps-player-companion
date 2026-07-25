import type { SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { newClientId } from './outbox.ts';

export const SYNC_LOG_RETENTION = 1_000;

/**
 * Per-value ceiling for the `previousValue` / `newValue` snapshots.
 * A `create` op's value is a whole entity row, and the journal keeps
 * 1,000 of them -- without a cap a few big rows (a long inventory
 * `notes`, a fat `tempEffects` array) could bloat IndexedDB for what is
 * only ever a diagnostic. Truncated values still show the user what
 * changed, which is the point.
 */
export const SYNC_LOG_VALUE_MAX_CHARS = 2_000;

export type NewSyncLogEntry = Omit<SyncLogEntry, 'id' | 'occurredAt'> & {
  id?: string;
  occurredAt?: string;
};

/**
 * Bound a value before it goes into the journal.  Scalars pass through
 * unchanged (the common case: one field of one character). Anything
 * whose JSON exceeds the cap is replaced by a marker object so the UI
 * can say "too large to record" rather than silently showing nothing.
 */
export function snapshotValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  let json: string;
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    return { truncated: true, note: 'value could not be serialized' };
  }
  if (json.length <= SYNC_LOG_VALUE_MAX_CHARS) return value;
  return { truncated: true, preview: json.slice(0, SYNC_LOG_VALUE_MAX_CHARS), length: json.length };
}

export async function appendSyncLog(entry: NewSyncLogEntry): Promise<void> {
  try {
    const db = getLocalDb();
    await db.syncLog.put({
      ...entry,
      id: entry.id ?? newClientId(),
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
    });
    await pruneSyncLog();
  } catch {
    // Diagnostic persistence must never interrupt outbox settlement.
  }
}

export async function pruneSyncLog(): Promise<void> {
  const db = getLocalDb();
  const count = await db.syncLog.count();
  const excess = count - SYNC_LOG_RETENTION;
  if (excess <= 0) return;
  const oldestIds = await db.syncLog.orderBy('occurredAt').limit(excess).primaryKeys();
  await db.syncLog.bulkDelete(oldestIds);
}

/** Hard cap on stored rejection records. */
export const REJECTION_RETENTION = 200;
/**
 * A rejection older than this stops being re-toasted on bootstrap.
 * `rejectionToasts` rows are persistent *because* the user must not
 * miss a rollback -- but a rejection from months ago is noise, not
 * news, and a wall of stale toasts is exactly as unhelpful as no toast
 * at all.  The row survives (auto-dismissed) as the audit trail, and
 * the sync-log dialog still lists it.
 */
export const REJECTION_REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export async function markRejectionDismissed(id: string): Promise<void> {
  try {
    await getLocalDb().rejectionToasts.update(id, { dismissedAt: new Date().toISOString() });
  } catch {
    // Best-effort: losing a dismissal only means the toast reappears.
  }
}

/**
 * Auto-dismiss rejections too old to replay, then trim the table to
 * `REJECTION_RETENTION`.  Unlike `syncLog` this store had no retention
 * at all, so it grew without bound for the life of the install.
 */
export async function pruneRejectionToasts(now: number = Date.now()): Promise<void> {
  try {
    const db = getLocalDb();
    const cutoff = new Date(now - REJECTION_REPLAY_MAX_AGE_MS).toISOString();
    const stale = await db.rejectionToasts
      .filter((r) => !r.dismissedAt && r.createdAt < cutoff)
      .primaryKeys();
    if (stale.length > 0) {
      const dismissedAt = new Date(now).toISOString();
      await db.rejectionToasts.bulkUpdate(stale.map((key) => ({ key, changes: { dismissedAt } })));
    }
    const excess = (await db.rejectionToasts.count()) - REJECTION_RETENTION;
    if (excess > 0) {
      const all = await db.rejectionToasts.toArray();
      const oldest = all
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, excess)
        .map((r) => r.id);
      await db.rejectionToasts.bulkDelete(oldest);
    }
  } catch {
    // Diagnostic housekeeping must never block a sync cycle.
  }
}
