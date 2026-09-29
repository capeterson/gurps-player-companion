import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import {
  getSyncWsSubscriber,
  resetSyncWsSubscriberForTests,
  syncWsLastConnectedKey,
} from './wsSubscriber.ts';

const { drain } = vi.hoisted(() => ({ drain: vi.fn() }));
vi.mock('./orchestrator.ts', () => ({ getSyncOrchestrator: () => ({ triggerDrain: drain }) }));

beforeEach(() => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(async () => {
  resetSyncWsSubscriberForTests();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await resetLocalDb();
});

it('a library WS nudge only triggers the standard sync cycle without touching query caches (S8)', () => {
  const sockets: EventTarget[] = [];
  class Socket extends EventTarget {
    constructor() {
      super();
      sockets.push(this);
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  tokenStore.write({ accessToken: 'token', refreshToken: 'refresh', accessTokenExpiresIn: 0 });
  const client = new QueryClient();
  client.setQueryData(['campaigns', 'a', 'library'], { traits: [] });
  client.setQueryData(['campaigns', 'b', 'library'], { traits: [] });
  try {
    getSyncWsSubscriber().start();
    sockets[0]?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ kind: 'sync_invalidate', campaignId: 'a' }),
      }),
    );
    expect(client.getQueryState(['campaigns', 'a', 'library'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['campaigns', 'b', 'library'])?.isInvalidated).toBe(false);
    expect(drain).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
  }
});

function authenticate(userId = 'user-one') {
  tokenStore.write({
    accessToken: `e30.${btoa(JSON.stringify({ sub: userId }))}.signature`,
    refreshToken: 'refresh',
    accessTokenExpiresIn: 3600,
  });
}

function installSockets() {
  const sockets: Socket[] = [];
  class Socket extends EventTarget {
    readyState = 0;
    send = vi.fn();
    close = vi.fn();
    constructor(readonly url: string) {
      super();
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    disconnect() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  return sockets;
}

it('reports connection and reconnecting status with a stable successful-open timestamp', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  const changed = vi.fn();
  subscriber.subscribe(changed);
  subscriber.start();
  expect(subscriber.status).toEqual({ state: 'connecting', lastConnectedAt: null });
  expect(subscriber.status).toBe(subscriber.status);
  sockets[0]?.open();
  expect(subscriber.status).toEqual({
    state: 'connected',
    lastConnectedAt: '2026-09-29T12:00:00.000Z',
  });
  vi.advanceTimersByTime(60_000);
  sockets[0]?.disconnect();
  expect(subscriber.status).toEqual({
    state: 'reconnecting',
    lastConnectedAt: '2026-09-29T12:00:00.000Z',
  });
  expect(changed).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  expect(subscriber.status.lastConnectedAt).toBe('2026-09-29T12:00:00.000Z');
  sockets[1]?.open();
  expect(subscriber.status).toEqual({
    state: 'connected',
    lastConnectedAt: '2026-09-29T12:01:01.000Z',
  });
});

it('retains the last connection across reloads and clears it when switching accounts', async () => {
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  sockets[0]?.open();
  const at = subscriber.status.lastConnectedAt;
  await vi.waitFor(async () => {
    expect((await getLocalDb().syncMeta.get(syncWsLastConnectedKey('user-one')))?.value).toBe(at);
  });
  resetSyncWsSubscriberForTests();
  const restarted = getSyncWsSubscriber();
  restarted.start();
  await vi.waitFor(() => expect(restarted.status.lastConnectedAt).toBe(at));
  authenticate('user-two');
  expect(restarted.status).toEqual({ state: 'connecting', lastConnectedAt: null });
  tokenStore.clear();
  expect(restarted.status).toEqual({ state: 'stopped', lastConnectedAt: null });
});

it('reports offline without changing HTTP sync, then reconnects when the browser comes online', () => {
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  sockets[0]?.open();
  const at = subscriber.status.lastConnectedAt;
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  expect(subscriber.status).toEqual({ state: 'offline', lastConnectedAt: at });
  expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
  expect(drain).not.toHaveBeenCalled();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(sockets).toHaveLength(2);
  expect(subscriber.status.state).toBe('reconnecting');
});

it('ignores open, close and invalidation events from an old socket after restart', () => {
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  const old = sockets[0];
  subscriber.stop();
  subscriber.start();
  sockets[1]?.open();
  const active = subscriber.status;
  old?.open();
  old?.disconnect();
  old?.dispatchEvent(new MessageEvent('message', { data: '{"kind":"sync_invalidate"}' }));
  expect(subscriber.status).toBe(active);
  expect(drain).not.toHaveBeenCalled();
  sockets[1]?.dispatchEvent(new MessageEvent('message', { data: '{"kind":"sync_invalidate"}' }));
  expect(drain).toHaveBeenCalledTimes(1);
});

it('reconnects with rotated credentials and ignores the preceding socket', () => {
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  sockets[0]?.open();
  const at = subscriber.status.lastConnectedAt;
  const previous = tokenStore.read();
  if (!previous) throw new Error('Missing test session');
  tokenStore.replaceIfCurrent(previous, {
    accessToken: `${previous.accessToken}-rotated`,
    refreshToken: 'new-refresh',
    accessTokenExpiresIn: 3600,
  });
  expect(sockets).toHaveLength(2);
  expect(sockets[1]?.url).toContain('-rotated');
  expect(subscriber.status.lastConnectedAt).toBe(at);
  sockets[1]?.open();
  sockets[0]?.disconnect();
  expect(subscriber.status.state).toBe('connected');
});

it('backs off failed handshakes without inventing a successful connection time', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const sockets = installSockets();
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  for (const delay of [1000, 2000, 4000]) {
    sockets.at(-1)?.disconnect();
    expect(subscriber.status).toEqual({ state: 'reconnecting', lastConnectedAt: null });
    vi.advanceTimersByTime(delay);
  }
  expect(sockets).toHaveLength(4);
  sockets[3]?.disconnect();
  vi.advanceTimersByTime(299_999);
  expect(sockets).toHaveLength(4);
  vi.advanceTimersByTime(1);
  expect(sockets).toHaveLength(5);
});

it('does not restore another account timestamp or recreate metadata after logout', async () => {
  const sockets = installSockets();
  await getLocalDb().syncMeta.put({
    key: syncWsLastConnectedKey('other-user'),
    value: '2026-09-28T12:00:00.000Z',
  });
  authenticate();
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  expect(subscriber.status.lastConnectedAt).toBeNull();
  sockets[0]?.open();
  tokenStore.clear();
  await getLocalDb().syncMeta.clear();
  await Promise.resolve();
  expect(await getLocalDb().syncMeta.toArray()).toEqual([]);
  expect(subscriber.status).toEqual({ state: 'stopped', lastConnectedAt: null });
});

it('times out a silent handshake once, then cancels the deadline on a real open and stop', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const sockets = installSockets();
  tokenStore.write({ accessToken: 'token', refreshToken: 'refresh', accessTokenExpiresIn: 0 });
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  vi.advanceTimersByTime(9999);
  expect(subscriber.status).toEqual({ state: 'connecting', lastConnectedAt: null });
  vi.advanceTimersByTime(1);
  expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
  expect(subscriber.status).toEqual({ state: 'reconnecting', lastConnectedAt: null });
  expect(vi.getTimerCount()).toBe(1); // Only the existing reconnect backoff.
  sockets[0]?.open();
  sockets[0]?.disconnect();
  expect(subscriber.status.lastConnectedAt).toBeNull();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  sockets[1]?.open();
  const connectedAt = subscriber.status.lastConnectedAt;
  expect(connectedAt).not.toBeNull();
  expect(vi.getTimerCount()).toBe(1); // Only the keepalive interval.
  vi.advanceTimersByTime(10_000);
  expect(subscriber.status).toEqual({ state: 'connected', lastConnectedAt: connectedAt });
  expect(sockets[1]?.close).not.toHaveBeenCalled();
  subscriber.stop();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(2);
  expect(subscriber.status.state).toBe('stopped');
});

it('cancels a pending handshake deadline on close and while stopping', () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  const sockets = installSockets();
  tokenStore.write({ accessToken: 'token', refreshToken: 'refresh', accessTokenExpiresIn: 0 });
  const subscriber = getSyncWsSubscriber();
  subscriber.start();
  expect(vi.getTimerCount()).toBe(1);
  sockets[0]?.disconnect();
  expect(vi.getTimerCount()).toBe(1); // Deadline replaced by reconnect backoff.
  vi.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  subscriber.stop();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(2);
  expect(subscriber.status).toEqual({ state: 'stopped', lastConnectedAt: null });
});
