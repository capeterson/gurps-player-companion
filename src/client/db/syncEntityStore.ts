import type { Table } from 'dexie';
import type { EntityClass } from '../../shared/schemas/sync.ts';
import { getLocalDb, storeForEntityClass } from './dexie.ts';

type SyncRow = { id: string; revision: number; [key: string]: unknown };

/** One store lookup for cursor reads and local-first outbox writes. */
export function syncEntityTable(entityClass: EntityClass): Table<SyncRow, string> | null {
  const store = storeForEntityClass(entityClass);
  if (!store) return null;
  return getLocalDb()[store] as unknown as Table<SyncRow, string>;
}

export function writableSyncEntityTable(entityClass: EntityClass): Table<SyncRow, string> {
  if (entityClass === 'campaign') throw new Error('Campaigns are cursor-only');
  const table = syncEntityTable(entityClass);
  if (!table) throw new Error(`No local writer for ${entityClass}`);
  return table;
}

export async function readSyncEntity(
  entityClass: EntityClass,
  entityId: string,
): Promise<SyncRow | undefined> {
  return syncEntityTable(entityClass)?.get(entityId);
}

export async function updateSyncEntity(
  entityClass: EntityClass,
  entityId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  await writableSyncEntityTable(entityClass).update(entityId, updates);
}

export async function deleteSyncEntity(entityClass: EntityClass, entityId: string): Promise<void> {
  await writableSyncEntityTable(entityClass).delete(entityId);
}

export async function stampSyncEntityRevision(
  entityClass: EntityClass,
  entityId: string,
  revision: number,
): Promise<void> {
  const db = getLocalDb();
  const table = writableSyncEntityTable(entityClass);
  await db.transaction('rw', table, async () => {
    await table
      .where(':id')
      .equals(entityId)
      .modify((existing) => {
        if (existing.revision < revision) existing.revision = revision;
      });
  });
}
