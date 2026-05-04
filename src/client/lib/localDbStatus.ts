import Dexie from 'dexie';

export interface LocalDbStatus {
  databaseNames: string[];
  dexieState: string;
  syncState: string;
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
  const dexieNames = databaseNames.filter((name) => name.toLowerCase().includes('dexie'));
  const knownNames = dexieNames.length > 0 ? dexieNames : databaseNames;

  return {
    databaseNames: knownNames,
    dexieState:
      knownNames.length > 0
        ? `${knownNames.length} local IndexedDB database${knownNames.length === 1 ? '' : 's'} available`
        : 'No local Dexie database has been created yet',
    syncState:
      knownNames.length > 0
        ? 'No pending local outbox table was detected in this build'
        : 'Fully synced — no local Dexie data is waiting to upload',
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
