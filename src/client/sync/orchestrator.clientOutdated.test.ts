/**
 * An outdated build (HTTP 426 from /sync/*) must keep every queued edit
 * exactly as it was and hand over to the forced reload, never roll back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { syncStateStore } from './state.ts';

const requestClientUpdate = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../sw/registerSW.ts', () => ({ requestClientUpdate }));

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

const outdated = () =>
  new Response(
    JSON.stringify({
      error: 'client_outdated',
      clientProtocol: 0,
      minProtocol: 1,
      serverProtocol: 1,
    }),
    { status: 426, headers: { 'content-type': 'application/json' } },
  );

type Internals = {
  maybeDrainOnce(): Promise<number | undefined>;
};

beforeEach(async () => {
  tokenStore.write({
    accessToken: jwtForUser('user-1'),
    refreshToken: 'r',
    accessTokenExpiresIn: 0,
  });
  const db = getLocalDb();
  await db.characters.put({
    id: 'char-1',
    ownerId: 'user-1',
    name: 'Edited',
    revision: 3,
  } as never);
  await db.outbox.put({
    clientOpId: 'op-1',
    entityClass: 'character',
    entityId: 'char-1',
    command: 'patch',
    coalesceKey: 'char-1|name',
    fieldPath: 'name',
    attemptedValue: 'Edited',
    prevValue: 'Original',
    baseRevision: 3,
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
    attemptCount: 0,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  requestClientUpdate.mockClear();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

describe('sync against a server that refuses this build', () => {
  it('sends the protocol header, keeps the queued op untouched and forces an update', async () => {
    const fetchMock = vi.fn(async () => outdated());
    vi.stubGlobal('fetch', fetchMock);
    const orchestrator = getSyncOrchestrator() as unknown as Internals;

    await orchestrator.maybeDrainOnce();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-gpc-sync-protocol']).toBe('1');
    const db = getLocalDb();
    expect(await db.outbox.get('op-1')).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      attemptedValue: 'Edited',
    });
    expect((await db.outbox.get('op-1'))?.deliveryUncertain).toBeFalsy();
    // No rollback: the local edit and no rejection toast.
    expect(await db.characters.get('char-1')).toMatchObject({ name: 'Edited' });
    expect(await db.rejectionToasts.count()).toBe(0);
    expect(requestClientUpdate).toHaveBeenCalledTimes(1);
    expect(syncStateStore.value).toBe('error');

    // Sync stays paused instead of re-sending the batch every cycle.
    await orchestrator.maybeDrainOnce();
    await getSyncOrchestrator().triggerCursorPull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestClientUpdate).toHaveBeenCalledTimes(1);
  });

  it('handles a 426 from the cursor pull without surfacing a pull failure', async () => {
    await getLocalDb().outbox.clear();
    const fetchMock = vi.fn(async () => outdated());
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSyncOrchestrator().triggerCursorPull()).resolves.toBeUndefined();
    expect(requestClientUpdate).toHaveBeenCalledTimes(1);
  });
});
