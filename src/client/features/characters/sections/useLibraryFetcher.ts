/**
 * Fetch a campaign's library (traits + skills + items) once via the
 * aggregate `GET /campaigns/{id}/library` endpoint, then return a
 * `fetchOptions(query)` function suitable for `<LibraryAutocomplete>`
 * that filters the requested kind client-side.
 *
 * Filtering is client-side because campaign libraries are typically
 * dozens to hundreds of entries — fast enough to substring-match in
 * the browser without server-side search infrastructure.
 *
 * Returns `null`-shaped behaviour (always-empty options) when the
 * character is not attached to a campaign, so the autocomplete just
 * acts as a plain input.
 *
 * Codex review on PR #22 caught the original implementation hitting
 * non-existent `/library/{kind}` GET endpoints (those paths only
 * accept POST for create) — fixed here by using the single aggregate
 * GET and picking the right array.
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

interface LibraryPayload {
  readonly traits: LibraryTraitOut[];
  readonly skills: LibrarySkillOut[];
  readonly items: LibraryItemOut[];
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
    // Single cache entry per campaign — all three kinds share the
    // aggregate response so picking traits then skills doesn't refetch.
    queryKey: ['campaignLibrary', campaignId],
    queryFn: async (): Promise<LibraryPayload> => {
      if (!campaignId) return { traits: [], skills: [], items: [] };
      try {
        return await api<LibraryPayload>(`/campaigns/${campaignId}/library`);
      } catch (err) {
        // 403 (member can't see campaign) shouldn't crash the form.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          return { traits: [], skills: [], items: [] };
        }
        throw err;
      }
    },
    staleTime: 30_000,
  });

  const fetchOptions = useCallback(
    async (q: string): Promise<T[]> => {
      const payload = query.data ?? { traits: [], skills: [], items: [] };
      // The caller's `T` is one of the three union members; the kind
      // arg discriminates which array we want. TS can't narrow through
      // the indexed access so this cast is necessary at the boundary.
      const list = payload[kind] as unknown as readonly T[];
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
    [query.data, kind],
  );

  return { fetchOptions, isLoading: query.isLoading };
}
