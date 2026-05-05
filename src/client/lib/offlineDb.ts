import Dexie, { type EntityTable } from 'dexie';

export interface OutboxEntry {
  id?: number;
  entity: 'character';
  entityId: string;
  op: 'patch';
  payload: Record<string, unknown>;
  createdAt: number;
  lastError: string | null;
}

export interface SyncMeta {
  key: 'state';
  status: 'idle' | 'syncing' | 'failed';
  updatedAt: number;
  lastError: string | null;
}

class OfflineDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'key'>;

  constructor() {
    super('gurps_player_companion');
    this.version(1).stores({
      outbox: '++id, entity, entityId, createdAt',
      syncMeta: '&key, status, updatedAt',
    });
  }
}

export const offlineDb = new OfflineDb();

