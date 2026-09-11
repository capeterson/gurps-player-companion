import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RejectionRecord, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import {
  REJECTION_REPLAY_MAX_AGE_MS,
  REJECTION_RETENTION,
  REVOKED_CHARACTERS_RETENTION,
  SYNC_LOG_RETENTION,
  SYNC_LOG_VALUE_MAX_CHARS,
  appendSyncLog,
  markRejectionDismissed,
  pruneRejectionToasts,
  readRevokedCampaigns,
  readRevokedCharacters,
  redactSyncLogForCampaigns,
  redactSyncLogForCharacters,
  rememberRevokedCampaigns,
  rememberRevokedCharacters,
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

  it('caps long strings too — notes/appearance accept 20k characters', () => {
    // Exempting strings would let a few edits to those fields retain
    // tens of MB across the 1,000 before/after pairs kept here.
    const long = 'x'.repeat(20_000);
    const snap = snapshotValue(long) as { truncated: boolean; length: number; preview: string };
    expect(snap.truncated).toBe(true);
    expect(snap.preview.length).toBe(SYNC_LOG_VALUE_MAX_CHARS);
    expect(snap.length).toBe(20_000);
  });

  it('leaves ordinary strings alone', () => {
    expect(snapshotValue('Longsword')).toBe('Longsword');
  });
});

describe('redactSyncLogForCharacters', () => {
  async function seedEntry(over: Partial<SyncLogEntry> & { id: string }) {
    await getLocalDb().syncLog.put({
      direction: 'push',
      result: 'synced',
      occurredAt: new Date().toISOString(),
      previousValue: 'secret-before',
      newValue: 'secret-after',
      details: { latestEntity: { st: 17 } },
      ...over,
    } as SyncLogEntry);
  }

  it('strips payloads for a character the viewer lost access to', async () => {
    await seedEntry({ id: 'a', entityClass: 'character', entityId: 'char-1' });

    const count = await redactSyncLogForCharacters(['char-1']);

    expect(count).toBe(1);
    const row = await getLocalDb().syncLog.get('a');
    expect(row?.previousValue).toBeUndefined();
    expect(row?.newValue).toBeUndefined();
    expect(row?.details).toBeUndefined();
    expect(row?.redacted).toBe(true);
    // Metadata survives -- the operational history stays intact.
    expect(row?.entityClass).toBe('character');
    expect(row?.occurredAt).toBeTruthy();
  });

  it('reaches child rows through parentId', async () => {
    // Matching on entityId alone would miss every trait/skill/
    // inventory edit made against the character.
    await seedEntry({
      id: 'b',
      entityClass: 'character_inventory',
      entityId: 'inv-9',
      parentId: 'char-1',
    });

    await redactSyncLogForCharacters(['char-1']);

    expect((await getLocalDb().syncLog.get('b'))?.redacted).toBe(true);
  });

  it('leaves other characters untouched', async () => {
    await seedEntry({ id: 'c', entityClass: 'character', entityId: 'char-2' });

    await redactSyncLogForCharacters(['char-1']);

    const row = await getLocalDb().syncLog.get('c');
    expect(row?.previousValue).toBe('secret-before');
    expect(row?.redacted).toBeUndefined();
  });

  it('is a no-op for an empty id set', async () => {
    await seedEntry({ id: 'd', entityClass: 'character', entityId: 'char-1' });
    expect(await redactSyncLogForCharacters([])).toBe(0);
    expect((await getLocalDb().syncLog.get('d'))?.previousValue).toBe('secret-before');
  });
});

describe('revoked-character ledger', () => {
  it('outlives the character row so a failed redaction fails closed', async () => {
    // pruneInaccessibleLocally records this before deleting the row.
    // If the later best-effort redaction throws, the ledger is the
    // durable evidence that keeps those records restricted.
    await rememberRevokedCharacters(['char-gone']);
    expect(await readRevokedCharacters()).toContain('char-gone');
  });

  it('merges without duplicating', async () => {
    await rememberRevokedCharacters(['a', 'b']);
    await rememberRevokedCharacters(['b', 'c']);
    expect(await readRevokedCharacters()).toEqual(['a', 'b', 'c']);
  });

  it('stays bounded', async () => {
    await rememberRevokedCharacters(
      Array.from({ length: REVOKED_CHARACTERS_RETENTION + 50 }, (_, i) => `c${i}`),
    );
    const ids = await readRevokedCharacters();
    expect(ids).toHaveLength(REVOKED_CHARACTERS_RETENTION);
    // Newest kept, oldest dropped.
    expect(ids).toContain(`c${REVOKED_CHARACTERS_RETENTION + 49}`);
    expect(ids).not.toContain('c0');
  });

  it('reads as empty when nothing was recorded', async () => {
    expect(await readRevokedCharacters()).toEqual([]);
  });
});

describe('downloaded campaign snapshot redaction', () => {
  it('scrubs values and leaves a fail-closed revocation marker', async () => {
    await getLocalDb().syncLog.put({
      id: 'campaign-log',
      direction: 'pull',
      result: 'synced',
      entityClass: 'campaign',
      entityId: 'campaign-gone',
      command: 'patch',
      occurredAt: new Date().toISOString(),
      previousValue: { description: 'private before' },
      newValue: { description: 'private after' },
    });

    await rememberRevokedCampaigns(['campaign-gone']);
    expect(await readRevokedCampaigns()).toContain('campaign-gone');
    expect(await redactSyncLogForCampaigns(['campaign-gone'])).toBe(1);
    expect(await getLocalDb().syncLog.get('campaign-log')).toMatchObject({ redacted: true });
    expect((await getLocalDb().syncLog.get('campaign-log'))?.newValue).toBeUndefined();
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
