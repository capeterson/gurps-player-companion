import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { SYNC_LOG_RETENTION, appendSyncLog } from './syncLog.ts';

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
