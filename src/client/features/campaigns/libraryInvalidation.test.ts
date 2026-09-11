import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../../db/dexie.ts';
import { mountLibraryInvalidations } from './libraryInvalidation.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLocalDb();
});

it.each(['active', 'prefetch'] as const)(
  'retains invalidation across a pending initial %s request',
  async (mode) => {
    const db = getLocalDb();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = mountLibraryInvalidations(client);
    let resolvePending: (value: string[]) => void = () => undefined;
    const pending = {
      promise: new Promise<string[]>((resolve) => {
        resolvePending = resolve;
      }),
      resolve: (value: string[]) => resolvePending(value),
    };
    const queryKey = ['campaigns', 'campaign', 'library'];
    const queryFn = vi
      .fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(['fresh']);
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = mode === 'active' ? observer.subscribe(() => {}) : () => {};
    const prefetch =
      mode === 'prefetch'
        ? client.prefetchQuery({ queryKey, queryFn, staleTime: Number.POSITIVE_INFINITY })
        : Promise.resolve();
    const invalidations = vi.spyOn(client, 'invalidateQueries');
    try {
      await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
      await db.campaigns.put({
        id: 'campaign',
        name: 'Campaign',
        ownerId: 'user',
        revision: 2,
      } as never);
      await waitFor(() => expect(invalidations).toHaveBeenCalledTimes(1));
      pending.resolve(['stale']);
      await prefetch;
      await waitFor(() => expect(invalidations).toHaveBeenCalledTimes(2));
      if (mode === 'active') {
        await waitFor(() => expect(client.getQueryData(queryKey)).toEqual(['fresh']));
        expect(queryFn).toHaveBeenCalledTimes(2);
      } else {
        expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
        expect(
          await client.fetchQuery({ queryKey, queryFn, staleTime: Number.POSITIVE_INFINITY }),
        ).toEqual(['fresh']);
      }
    } finally {
      pending.resolve([]);
      unsubscribe();
      stop();
      client.clear();
    }
  },
);

it('observes commits from another database connection for every cache, ignores aborts, and unsubscribes', async () => {
  const db = getLocalDb();
  await db.campaigns.put({
    id: 'campaign',
    name: 'Campaign',
    ownerId: 'user',
    revision: 1,
  } as never);
  const clients = [new QueryClient(), new QueryClient()];
  const spies = clients.map((client) => vi.spyOn(client, 'invalidateQueries'));
  const stop = clients.map(mountLibraryInvalidations);
  const writer = new Dexie(db.name);
  await writer.open();
  try {
    await waitFor(() => {
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    });
    for (const client of clients) {
      client.setQueryData(['campaigns', 'campaign', 'library'], []);
      client.setQueryData(['campaigns', 'other', 'library'], []);
    }
    for (const spy of spies) spy.mockClear();
    await expect(
      writer.transaction('rw', writer.table('campaigns'), async () => {
        await writer.table('campaigns').update('campaign', { revision: 2 });
        throw new Error('Abort');
      }),
    ).rejects.toThrow('Abort');
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    await writer.table('campaigns').update('campaign', { revision: 2 });
    await waitFor(() => {
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    });
    for (const client of clients) {
      expect(client.getQueryState(['campaigns', 'campaign', 'library'])?.isInvalidated).toBe(true);
      expect(client.getQueryState(['campaigns', 'other', 'library'])?.isInvalidated).toBe(false);
    }
    stop[1]?.();
    await writer.table('campaigns').update('campaign', { revision: 3 });
    await waitFor(() => expect(spies[0]).toHaveBeenCalledTimes(2));
    expect(spies[1]).toHaveBeenCalledTimes(1);
  } finally {
    for (const unsubscribe of stop) unsubscribe();
    for (const client of clients) client.clear();
    writer.close();
  }
});
