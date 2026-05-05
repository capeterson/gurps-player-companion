import { offlineDb, type OutboxEntry } from './offlineDb.ts';
import { api } from './api.ts';

let started = false;

async function setState(status: 'idle' | 'syncing' | 'failed', lastError: string | null = null) {
  await offlineDb.syncMeta.put({ key: 'state', status, updatedAt: Date.now(), lastError });
}

async function syncOne(entry: OutboxEntry): Promise<void> {
  if (!entry.id) return;
  if (entry.entity === 'character' && entry.op === 'patch') {
    await api(`/characters/${entry.entityId}`, { method: 'PATCH', body: entry.payload });
    await offlineDb.outbox.delete(entry.id);
  }
}

export async function enqueueCharacterPatch(entityId: string, payload: Record<string, unknown>) {
  await offlineDb.outbox.add({
    entity: 'character',
    entityId,
    op: 'patch',
    payload,
    createdAt: Date.now(),
    lastError: null,
  });
}

export function startOfflineSyncLoop(onSyncError?: (message: string) => void): void {
  if (started) return;
  started = true;
  void setState('idle');

  const tick = async () => {
    const next = await offlineDb.outbox.orderBy('createdAt').first();
    if (!next) {
      await setState('idle');
      return;
    }
    await setState('syncing');
    try {
      await syncOne(next);
      await setState('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown sync failure';
      await offlineDb.outbox.update(next.id!, { lastError: message });
      await setState('failed', message);
      onSyncError?.(message);
    }
  };

  void tick();
  window.setInterval(() => {
    void tick();
  }, 1500);
  window.addEventListener('online', () => {
    void tick();
  });
}

