import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { mountLibraryInvalidations } from '../features/campaigns/libraryInvalidation.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncWsSubscriber, resetSyncWsSubscriberForTests } from './wsSubscriber.ts';

const { drain } = vi.hoisted(() => ({ drain: vi.fn() }));
vi.mock('./orchestrator.ts', () => ({ getSyncOrchestrator: () => ({ triggerDrain: drain }) }));

afterEach(() => {
  resetSyncWsSubscriberForTests();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('a library WS nudge refreshes only the named campaign query and triggers the standard sync cycle', () => {
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
  const unmount = mountLibraryInvalidations(client);
  try {
    getSyncWsSubscriber().start();
    sockets[0]?.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ kind: 'sync_invalidate', campaignId: 'a' }),
      }),
    );
    expect(client.getQueryState(['campaigns', 'a', 'library'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['campaigns', 'b', 'library'])?.isInvalidated).toBe(false);
    expect(drain).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    client.clear();
  }
});
