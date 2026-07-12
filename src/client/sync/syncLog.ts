import type { SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { newClientId } from './outbox.ts';

export const SYNC_LOG_RETENTION = 1_000;

export type NewSyncLogEntry = Omit<SyncLogEntry, 'id' | 'occurredAt'> & {
  id?: string;
  occurredAt?: string;
};

export async function appendSyncLog(entry: NewSyncLogEntry): Promise<void> {
  const db = getLocalDb();
  await db.syncLog.put({
    ...entry,
    id: entry.id ?? newClientId(),
    occurredAt: entry.occurredAt ?? new Date().toISOString(),
  });
  await pruneSyncLog();
}

export async function pruneSyncLog(): Promise<void> {
  const db = getLocalDb();
  const count = await db.syncLog.count();
  const excess = count - SYNC_LOG_RETENTION;
  if (excess <= 0) return;
  const oldestIds = await db.syncLog.orderBy('occurredAt').limit(excess).primaryKeys();
  await db.syncLog.bulkDelete(oldestIds);
}
