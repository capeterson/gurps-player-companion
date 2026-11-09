/**
 * The drain loop's idle safety wake must not re-pull /sync/cursor every five
 * seconds: it pulls only when no pull completed recently. Every other pull
 * trigger keeps its own cadence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { syncStateStore } from './state.ts';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

type Internals = { maybeDrainOnce(manual?: boolean): Promise<number | undefined> };

const cursorResponse = () =>
  new Response(JSON.stringify({ changes: [], nextCursor: {}, hasMore: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;
const cursorCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/sync/cursor')).length;

beforeEach(() => {
  tokenStore.write({
    accessToken: jwtForUser('user-1'),
    refreshToken: 'r',
    accessTokenExpiresIn: 0,
  });
  getSyncOrchestrator().setCurrentUser('user-1');
  fetchMock = vi.fn(async () => cursorResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

describe('idle drain-loop cursor pull', () => {
  it('pulls on the first idle wake, skips wakes inside the interval, then pulls again', async () => {
    const orchestrator = getSyncOrchestrator() as unknown as Internals;
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);

    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(1);

    now.mockReturnValue(start + 5_000);
    await orchestrator.maybeDrainOnce();
    now.mockReturnValue(start + 10_000);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(1);

    now.mockReturnValue(start + 15_000);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(2);
  });

  it('keeps five-second pulls for 15 seconds after a WebSocket nudge, then throttles again', async () => {
    const orchestrator = getSyncOrchestrator() as unknown as Internals;
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(1);

    now.mockReturnValue(start + 1_000);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(1);
    getSyncOrchestrator().triggerDrain();
    for (const offset of [1_000, 6_000, 11_000]) {
      now.mockReturnValue(start + offset);
      await orchestrator.maybeDrainOnce();
    }
    expect(cursorCalls()).toBe(4);
    // The window closed at start + 16s; the last pull was at start + 11s.
    now.mockReturnValue(start + 17_000);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(4);
    now.mockReturnValue(start + 26_000);
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(5);
  });

  it('keeps the explicit pull available inside the interval', async () => {
    const orchestrator = getSyncOrchestrator() as unknown as Internals;
    await orchestrator.maybeDrainOnce();
    expect(cursorCalls()).toBe(1);

    await getSyncOrchestrator().triggerCursorPull();
    expect(cursorCalls()).toBe(2);
  });
});
