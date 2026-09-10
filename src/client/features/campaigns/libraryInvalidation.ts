import type { QueryClient } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { getLocalDb } from '../../db/dexie.ts';

export function mountLibraryInvalidations(queryClient: QueryClient): () => void {
  let revisions = new Map<string, number>();
  let mounted = true;
  const refresh = async (campaignId: string) => {
    const filters = { queryKey: ['campaigns', campaignId, 'library'] };
    // Query reuses an initial pending fetch when there is no cached data. That
    // stale success clears invalidation, so retain the revision's refresh intent
    // until the request settles (also for an inactive prefetch).
    const initialFetches = queryClient
      .getQueryCache()
      .findAll(filters)
      .filter((query) => query.state.data === undefined && query.state.fetchStatus === 'fetching')
      .flatMap((query) => (query.promise ? [query.promise] : []));
    await queryClient.invalidateQueries(filters);
    if (initialFetches.length > 0) {
      await Promise.allSettled(initialFetches);
      if (mounted) await queryClient.invalidateQueries(filters, { cancelRefetch: false });
    }
  };
  // Dexie observes committed changes across browser tabs. Every tab has its own
  // QueryClient, even when another tab consumes the shared HTTP cursor first.
  const subscription = liveQuery(() => getLocalDb().campaigns.toArray()).subscribe((rows) => {
    const next = new Map(rows.map((row) => [row.id, row.revision]));
    for (const id of new Set([...revisions.keys(), ...next.keys()])) {
      if (revisions.get(id) !== next.get(id)) void refresh(id);
    }
    revisions = next;
  });
  return () => {
    mounted = false;
    subscription.unsubscribe();
  };
}
