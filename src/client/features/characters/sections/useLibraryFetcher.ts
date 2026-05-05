/**
 * Fetch a campaign's library traits / skills / items once (TanStack
 * Query caches), then return a `fetchOptions(query)` function suitable
 * for `<LibraryAutocomplete>`. Filtering is client-side because
 * campaign libraries are typically dozens to hundreds of entries —
 * fast enough to substring-match in the browser without server-side
 * search infrastructure.
 *
 * Returns `null`-shaped behaviour (always-empty options) when the
 * character is not attached to a campaign, so the autocomplete just
 * acts as a plain input.
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  LibraryItemOut,
  LibrarySkillOut,
  LibraryTraitOut,
} from '../../../../shared/schemas/campaignLibrary.ts';
import { ApiError, api } from '../../../lib/api.ts';

type Kind = 'traits' | 'skills' | 'items';

type LibraryEntry = LibraryTraitOut | LibrarySkillOut | LibraryItemOut;

function pathFor(kind: Kind, campaignId: string): string {
  return `/campaigns/${campaignId}/library/${kind}`;
}

export function useLibraryFetcher<T extends LibraryEntry>(
  kind: Kind,
  campaignId: string | null,
): {
  fetchOptions: (query: string) => Promise<T[]>;
  isLoading: boolean;
} {
  const enabled = typeof campaignId === 'string' && campaignId.length > 0;
  const query = useQuery({
    enabled,
    queryKey: ['campaignLibrary', kind, campaignId],
    queryFn: async (): Promise<T[]> => {
      if (!campaignId) return [];
      try {
        return await api<T[]>(pathFor(kind, campaignId));
      } catch (err) {
        // 403 (member can't see campaign) shouldn't crash the form.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 30_000,
  });

  const fetchOptions = useCallback(
    async (q: string): Promise<T[]> => {
      const list = query.data ?? [];
      if (q.length === 0) return list.slice(0, 20);
      const needle = q.toLowerCase();
      const ranked = list
        .map((opt) => {
          const name = opt.name.toLowerCase();
          let score = 0;
          if (name.startsWith(needle)) score = 3;
          else if (name.includes(needle)) score = 2;
          // tags / source partial match (cheap, non-allocating substring)
          else if ('tags' in opt && opt.tags.some((t) => t.toLowerCase().includes(needle))) {
            score = 1;
          }
          return { opt, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.opt.name.localeCompare(b.opt.name))
        .slice(0, 12)
        .map((r) => r.opt);
      return ranked;
    },
    [query.data],
  );

  return { fetchOptions, isLoading: query.isLoading };
}
