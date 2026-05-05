import Dexie from 'dexie';

export interface LocalDbStatus {
  syncState: string;
  isFullySynced: boolean;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  refreshedAt: Date;
}

async function getDatabaseNames(): Promise<string[]> {
  if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
    const databases = await indexedDB.databases();
    return databases.map((db) => db.name).filter((name): name is string => Boolean(name));
  }
  return Dexie.getDatabaseNames();
}

async function getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export async function readLocalDbStatus(): Promise<LocalDbStatus> {
  const [databaseNames, storage] = await Promise.all([getDatabaseNames(), getStorageEstimate()]);
  return {
    syncState:
      databaseNames.length > 0
        ? 'Fully synced — local sync storage is available'
        : 'Fully synced — no local data is waiting to upload',
    isFullySynced: true,
    storageUsageBytes: storage.usage,
    storageQuotaBytes: storage.quota,
    refreshedAt: new Date(),
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (const next of units.slice(1)) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
