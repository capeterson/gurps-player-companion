/**
 * Surface for the Settings page's "local sync" panel.  Pulls live
 * counts from the real Dexie database (outbox + character stores)
 * rather than the older "are there any indexedDB databases at all?"
 * stub it replaced.
 */

import { getLocalDb } from '../db/dexie.ts';
import { countPending } from '../sync/outbox.ts';

export interface LocalDbStatus {
  syncState: string;
  isFullySynced: boolean;
  pendingOps: number;
  characters: number;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  refreshedAt: Date;
}

async function getStorageEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}

export async function readLocalDbStatus(): Promise<LocalDbStatus> {
  const db = getLocalDb();
  const [pendingOps, characterCount, storage] = await Promise.all([
    countPending(),
    db.characters.count(),
    getStorageEstimate(),
  ]);
  const isFullySynced = pendingOps === 0;
  return {
    syncState: isFullySynced
      ? 'Fully synced — no pending operations'
      : `${pendingOps} pending operation${pendingOps === 1 ? '' : 's'}`,
    isFullySynced,
    pendingOps,
    characters: characterCount,
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
