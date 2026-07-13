import { afterEach, describe, expect, it } from 'vitest';
import type { OutboxEntry, RejectionRecord, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { buildSyncDebugDump } from './debugDump.ts';
import { syncStateStore } from './state.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

afterEach(async () => {
  await resetLocalDb();
  tokenStore.clear();
  syncStateStore.reset('synced');
});

describe('buildSyncDebugDump', () => {
  it('includes metadata, pending counts, and every diagnostic store', async () => {
    const db = getLocalDb();
    tokenStore.write({
      accessToken: jwtForUser('user-123'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 900,
    });
    syncStateStore.reset('error');

    const pendingOp: OutboxEntry = {
      clientOpId: 'op-pending',
      entityClass: 'character',
      entityId: 'char-1',
      command: 'patch',
      coalesceKey: 'char-1|name',
      fieldPath: 'name',
      attemptedValue: 'New Name',
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 0,
    };
    const retryingOp: OutboxEntry = {
      ...pendingOp,
      clientOpId: 'op-retrying',
      coalesceKey: 'char-1|st',
      fieldPath: 'st',
      status: 'transient_retry',
      attemptCount: 2,
    };
    await db.outbox.bulkAdd([pendingOp, retryingOp]);

    const rejection: RejectionRecord = {
      id: 'rej-1',
      clientOpId: 'op-old',
      entityClass: 'character',
      entityId: 'char-1',
      reason: 'ST must be >= 1',
      status: 'rejected',
      createdAt: new Date().toISOString(),
    };
    await db.rejectionToasts.add(rejection);

    const logEntry: SyncLogEntry = {
      id: 'log-1',
      direction: 'push',
      result: 'synced',
      entityClass: 'character',
      entityId: 'char-1',
      command: 'patch',
      occurredAt: new Date().toISOString(),
    };
    await db.syncLog.add(logEntry);

    await db.syncCursors.add({ entityClass: 'character', revision: 42 });
    await db.characters.add({
      id: 'char-1',
      ownerId: 'user-123',
      campaignId: null,
      name: 'Someone Else Entirely',
    } as never);

    const dump = await buildSyncDebugDump();

    expect(dump.meta.userId).toBe('user-123');
    expect(dump.meta.syncIndicatorState).toBe('error');
    expect(dump.meta.onLine).toBe(true);
    expect(dump.meta.pendingCounts).toEqual({ pending: 1, inFlight: 0, transientRetry: 1 });
    expect(dump.meta.storeCounts.characters).toBe(1);
    expect(dump.meta.storeCounts.outbox).toBe(2);
    expect(dump.meta.storeCounts.rejectionToasts).toBe(1);
    expect(dump.meta.storeCounts.syncLog).toBe(1);

    expect(dump.outbox).toHaveLength(2);
    expect(dump.rejectionToasts).toHaveLength(1);
    expect(dump.syncLog).toHaveLength(1);
    expect(dump.syncCursors).toHaveLength(1);
  });

  it('never leaks the access token, and excludes entity-row payloads', async () => {
    const db = getLocalDb();
    const secretToken = 'super-secret-access-token-value';
    tokenStore.write({
      accessToken: `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(
        JSON.stringify({ sub: 'user-456' }),
      )}.${secretToken}`,
      refreshToken: 'refresh-should-also-never-appear',
      accessTokenExpiresIn: 900,
    });
    await db.characters.add({
      id: 'char-private',
      ownerId: 'user-456',
      campaignId: null,
      name: 'Private Character Name Should Not Leak',
    } as never);

    const dump = await buildSyncDebugDump();
    const serialized = JSON.stringify(dump);

    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('refresh-should-also-never-appear');
    expect(serialized).not.toContain('Private Character Name Should Not Leak');
    // No entity-store keys on the dump at all -- only counts.
    expect(dump).not.toHaveProperty('characters');
    expect(dump).not.toHaveProperty('characterInventory');
  });

  it('reports null userId when no session is present', async () => {
    const dump = await buildSyncDebugDump();
    expect(dump.meta.userId).toBeNull();
  });
});
