import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncLogEntry } from '../db/dexie.ts';
import { ALL_STORE_NAMES, getLocalDb } from '../db/dexie.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import {
  SYNC_LOG_RETENTION,
  appendSyncLog,
  appendSyncLogEntries,
  flushSyncLogPrune,
  redactSyncLogForCampaigns,
  redactSyncLogForCharacters,
} from './syncLog.ts';
import { loadSyncLogEntry, packSyncLogEntry } from './syncLogPayload.ts';
import * as payloadCodec from './syncLogPayload.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSyncOrchestratorForTests();
});

function largeEntry(id = 'large'): SyncLogEntry {
  return {
    id,
    direction: 'push',
    result: 'synced',
    entityClass: 'character',
    entityId: 'hero',
    command: 'patch',
    fieldPath: 'notes',
    occurredAt: '2026-09-29T00:00:00Z',
    previousValue: 'Old field notes. '.repeat(90),
    newValue: 'New field notes. '.repeat(90),
    details: { status: 'applied', newRevision: 42 },
  };
}

describe('compressed journal payloads', () => {
  it('does not repopulate journal bodies when compression finishes after logout', async () => {
    const packed = await packSyncLogEntry(largeEntry());
    let finish!: (value: typeof packed) => void;
    vi.spyOn(payloadCodec, 'packSyncLogEntry').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const write = appendSyncLog(largeEntry());
    await getSyncOrchestrator().purge();
    finish(packed);
    await write;
    expect(await getLocalDb().syncLog.count()).toBe(0);
    expect(await getLocalDb().syncLogBodies.count()).toBe(0);
  });

  it('upgrades legacy journal/outbox stores without rewriting their records', async () => {
    const legacy = new Dexie('gurps-pc-local');
    legacy.version(14).stores({
      syncLog: 'id, occurredAt, direction, result, [direction+occurredAt]',
      outbox: 'clientOpId, status, coalesceKey, enqueuedAt, entityId, [status+enqueuedAt]',
    });
    const entry = largeEntry();
    const operation = {
      clientOpId: 'unsaved',
      entityId: 'hero',
      entityClass: 'character',
      command: 'patch',
      fieldPath: 'appearance',
      attemptedValue: 'My unsaved description',
      status: 'pending',
      coalesceKey: 'hero|appearance',
      enqueuedAt: entry.occurredAt,
      validationVersion: 1,
      attemptCount: 0,
    };
    try {
      await legacy.table('syncLog').put(entry);
      await legacy.table('outbox').put(operation);
    } finally {
      legacy.close();
    }
    const db = getLocalDb();
    expect(await db.syncLog.get(entry.id)).toEqual(entry);
    expect(await db.outbox.get('unsaved')).toEqual(operation);
    expect(await db.syncLogBodies.count()).toBe(0);
    expect(await loadSyncLogEntry(entry)).toBe(entry);
  });

  it('stores gzip separately and restores readable values without changing the journal', async () => {
    const original = largeEntry();
    await appendSyncLog(original);
    const db = getLocalDb();
    const row = await db.syncLog.get(original.id);
    const body = await db.syncLogBodies.get(original.id);
    expect(row).toMatchObject({
      payloadStored: true,
      payloadMetadata: { hasValueSnapshot: true, newRevision: 42 },
    });
    expect(row?.previousValue).toBeUndefined();
    expect(row?.details).toBeUndefined();
    expect(body?.encoding).toBe('gzip');
    expect(body?.bytes.byteLength).toBeLessThan(500);
    expect(body?.bytes[0]).toBe(0x1f);
    expect(body?.bytes[1]).toBe(0x8b);
    expect(await loadSyncLogEntry(row as SyncLogEntry)).toEqual(original);
    expect((await db.syncLog.get(original.id))?.payloadStored).toBe(true);
  });

  it('keeps small acknowledgements and legacy inline rows unchanged', async () => {
    const small = { ...largeEntry(), previousValue: 10, newValue: 14 };
    expect(await packSyncLogEntry(small)).toEqual({ entry: small });
    expect(await loadSyncLogEntry(small)).toBe(small);
  });

  it('falls back to inline storage when native compression is unavailable or fails', async () => {
    const original = largeEntry();
    vi.stubGlobal('CompressionStream', undefined);
    expect(await packSyncLogEntry(original)).toEqual({ entry: original });
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('Compression failed');
        }
      },
    );
    await appendSyncLog(original);
    expect(await getLocalDb().syncLog.get(original.id)).toEqual(original);
    expect(await getLocalDb().syncLogBodies.count()).toBe(0);
  });

  it('keeps the inline representation when compression would not save space', async () => {
    vi.stubGlobal(
      'CompressionStream',
      class extends TransformStream {
        constructor() {
          super({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
          });
        }
      },
    );
    const original = largeEntry();
    expect(await packSyncLogEntry(original)).toEqual({ entry: original });
  });

  it('does not await external streams in an existing outbox transaction', async () => {
    const db = getLocalDb();
    await db.transaction('rw', ALL_STORE_NAMES, async () => {
      expect(Dexie.currentTransaction).toBeDefined();
      await appendSyncLog(largeEntry());
      await db.syncMeta.put({ key: 'transaction-still-active', value: true });
    });
    expect(await db.syncLog.get('large')).toEqual(largeEntry());
    expect((await db.syncMeta.get('transaction-still-active'))?.value).toBe(true);
  });

  it('reports missing or corrupted compressed bodies without losing metadata', async () => {
    const db = getLocalDb();
    await appendSyncLog(largeEntry());
    const entry = (await db.syncLog.get('large')) as SyncLogEntry;
    await db.syncLogBodies.update('large', { bytes: new Uint8Array([0, 1, 2]) });
    await expect(loadSyncLogEntry(entry)).rejects.toThrow();
    await db.syncLogBodies.delete('large');
    await expect(loadSyncLogEntry(entry)).rejects.toThrow('no longer available');
    expect((await db.syncLog.get('large'))?.entityId).toBe('hero');
  });

  it.each(['character', 'campaign'] as const)(
    'deletes the %s body on access redaction',
    async (family) => {
      const db = getLocalDb();
      await appendSyncLog({ ...largeEntry(), entityClass: family });
      const stale = (await db.syncLog.get('large')) as SyncLogEntry;
      if (family === 'character') await redactSyncLogForCharacters(['hero']);
      else await redactSyncLogForCampaigns(['hero']);
      expect(await db.syncLogBodies.count()).toBe(0);
      const row = await loadSyncLogEntry(stale);
      expect(row.redacted).toBe(true);
      expect(row.payloadStored).toBeUndefined();
      expect(row.newValue).toBeUndefined();
    },
  );

  it('prunes compressed bodies with their journal rows and removes overwritten bodies', async () => {
    const db = getLocalDb();
    await appendSyncLog(largeEntry('old'));
    await appendSyncLog(largeEntry('rewritten'));
    expect(await db.syncLogBodies.get('rewritten')).toBeDefined();
    await appendSyncLog({ ...largeEntry('rewritten'), previousValue: 10, newValue: 14 });
    expect(await db.syncLogBodies.get('rewritten')).toBeUndefined();
    await appendSyncLogEntries(
      Array.from({ length: SYNC_LOG_RETENTION }, (_, index) => ({
        id: `new-${index}`,
        direction: 'pull',
        result: 'synced',
        occurredAt: '2026-09-29T00:00:01Z',
      })),
    );
    await flushSyncLogPrune();
    expect(await db.syncLog.get('old')).toBeUndefined();
    expect(await db.syncLogBodies.get('old')).toBeUndefined();
    expect(await db.syncLogBodies.count()).toBe(0);
  });
});
