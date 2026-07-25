import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RejectionRecord } from '../db/dexie.ts';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import {
  REJECTION_REPLAY_MAX_AGE_MS,
  REJECTION_RETENTION,
  SYNC_LOG_RETENTION,
  SYNC_LOG_VALUE_MAX_CHARS,
  appendSyncLog,
  markRejectionDismissed,
  pruneRejectionToasts,
  snapshotValue,
} from './syncLog.ts';

afterEach(async () => {
  await resetLocalDb();
});

describe('sync log', () => {
  it('retains only the newest 1,000 records', async () => {
    const db = getLocalDb();
    const entries = Array.from({ length: SYNC_LOG_RETENTION }, (_, index) => ({
      id: `entry-${index.toString().padStart(4, '0')}`,
      direction: 'pull' as const,
      result: 'synced' as const,
      entityClass: 'character' as const,
      entityId: `character-${index}`,
      command: 'patch' as const,
      occurredAt: new Date(index).toISOString(),
    }));
    await db.syncLog.bulkAdd(entries);

    await appendSyncLog({
      id: 'newest',
      direction: 'push',
      result: 'synced',
      entityClass: 'character',
      entityId: 'character-new',
      command: 'patch',
      occurredAt: new Date(SYNC_LOG_RETENTION + 1).toISOString(),
    });

    expect(await db.syncLog.count()).toBe(SYNC_LOG_RETENTION);
    expect(await db.syncLog.get('entry-0000')).toBeUndefined();
    expect(await db.syncLog.get('newest')).toBeTruthy();
  });

  it('does not throw when diagnostic persistence fails', async () => {
    const put = vi
      .spyOn(getLocalDb().syncLog, 'put')
      .mockRejectedValue(new Error('quota exceeded'));

    await expect(
      appendSyncLog({
        direction: 'push',
        result: 'synced',
        entityClass: 'character',
        entityId: 'character-1',
        command: 'patch',
      }),
    ).resolves.toBeUndefined();

    expect(put).toHaveBeenCalledOnce();
  });
});

describe('snapshotValue', () => {
  it('passes scalars through untouched', () => {
    expect(snapshotValue(12)).toBe(12);
    expect(snapshotValue('a note')).toBe('a note');
    expect(snapshotValue(null)).toBeNull();
    expect(snapshotValue(undefined)).toBeUndefined();
  });

  it('keeps small objects whole', () => {
    const value = { name: 'Torch', quantity: 2 };
    expect(snapshotValue(value)).toEqual(value);
  });

  it('truncates values too big for a bounded journal', () => {
    const huge = { notes: 'x'.repeat(SYNC_LOG_VALUE_MAX_CHARS + 500) };
    const snap = snapshotValue(huge) as { truncated: boolean; length: number; preview: string };
    expect(snap.truncated).toBe(true);
    expect(snap.preview.length).toBe(SYNC_LOG_VALUE_MAX_CHARS);
    expect(snap.length).toBeGreaterThan(SYNC_LOG_VALUE_MAX_CHARS);
  });
});

describe('rejection record retention', () => {
  function record(id: string, createdAt: string): RejectionRecord {
    return {
      id,
      clientOpId: id,
      entityClass: 'character',
      entityId: 'char-1',
      reason: 'newer server revision',
      status: 'rejected',
      createdAt,
    };
  }

  it('persists a dismissal so bootstrap stops replaying it', async () => {
    const db = getLocalDb();
    await db.rejectionToasts.put(record('op-1', new Date().toISOString()));

    await markRejectionDismissed('op-1');

    expect((await db.rejectionToasts.get('op-1'))?.dismissedAt).toBeTruthy();
  });

  it('auto-dismisses rejections too old to be news, keeping the audit row', async () => {
    const db = getLocalDb();
    const now = Date.now();
    const old = new Date(now - REJECTION_REPLAY_MAX_AGE_MS - 1_000).toISOString();
    const fresh = new Date(now - 60_000).toISOString();
    await db.rejectionToasts.bulkPut([record('old', old), record('fresh', fresh)]);

    await pruneRejectionToasts(now);

    expect((await db.rejectionToasts.get('old'))?.dismissedAt).toBeTruthy();
    expect((await db.rejectionToasts.get('fresh'))?.dismissedAt).toBeUndefined();
  });

  it('caps the table, which previously grew for the life of the install', async () => {
    const db = getLocalDb();
    const now = Date.now();
    await db.rejectionToasts.bulkPut(
      Array.from({ length: REJECTION_RETENTION + 25 }, (_, i) =>
        record(`op-${String(i).padStart(4, '0')}`, new Date(now - (1_000 - i)).toISOString()),
      ),
    );

    await pruneRejectionToasts(now);

    expect(await db.rejectionToasts.count()).toBe(REJECTION_RETENTION);
    expect(await db.rejectionToasts.get('op-0000')).toBeUndefined();
  });
});
