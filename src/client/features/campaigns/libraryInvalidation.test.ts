import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../../db/dexie.ts';
import { mountLibraryInvalidations } from './libraryInvalidation.ts';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLocalDb();
});

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
