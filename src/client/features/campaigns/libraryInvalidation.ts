import type { QueryClient } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { getLocalDb } from '../../db/dexie.ts';

export function mountLibraryInvalidations(queryClient: QueryClient): () => void {
  let revisions = new Map<string, number>();
  // Dexie observes committed changes across browser tabs. Every tab has its own
  // QueryClient, even when another tab consumes the shared HTTP cursor first.
  const subscription = liveQuery(() => getLocalDb().campaigns.toArray()).subscribe((rows) => {
    const next = new Map(rows.map((row) => [row.id, row.revision]));
    for (const id of new Set([...revisions.keys(), ...next.keys()])) {
      if (revisions.get(id) !== next.get(id))
        void queryClient.invalidateQueries({ queryKey: ['campaigns', id, 'library'] });
    }
    revisions = next;
  });
  return () => subscription.unsubscribe();
}
