/**
 * Fetch a campaign's library traits + skills via React Query and return
 * lookup maps from library-id → effect declarations.  Passed into
 * `useCharacterDetail` so the client-side derivation joins trait/skill
 * effects the same way the server does — without needing to add the
 * library tables to the Dexie sync surface.
 *
 * Cache is shared with `useLibraryFetcher` (same queryKey).
 */

import { useQuery } from '@tanstack/react-query';
import type { LibrarySkillOut, LibraryTraitOut } from '../../../shared/schemas/campaignLibrary.ts';
import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import { ApiError, api } from '../../lib/api.ts';

interface LibraryPayload {
  readonly traits: LibraryTraitOut[];
  readonly skills: LibrarySkillOut[];
}

export interface LibraryEffectMaps {
  /** library_trait.id → effects[] */
  readonly libraryTraitEffects: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  /** library_skill.id → effects[] */
  readonly librarySkillEffects: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  readonly isLoading: boolean;
}

const EMPTY_MAP = new Map<string, ReadonlyArray<TraitEffect>>();

export function useLibraryEffectMaps(campaignId: string | null | undefined): LibraryEffectMaps {
  const enabled = typeof campaignId === 'string' && campaignId.length > 0;
  const query = useQuery({
    enabled,
    queryKey: ['campaignLibrary', campaignId ?? null],
    queryFn: async (): Promise<LibraryPayload> => {
      if (!campaignId) return { traits: [], skills: [] };
      try {
        return await api<LibraryPayload>(`/campaigns/${campaignId}/library`);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          return { traits: [], skills: [] };
        }
        throw err;
      }
    },
    staleTime: 30_000,
  });

  if (!query.data) {
    return {
      libraryTraitEffects: EMPTY_MAP,
      librarySkillEffects: EMPTY_MAP,
      isLoading: query.isLoading,
    };
  }
  const traitMap = new Map<string, ReadonlyArray<TraitEffect>>();
  for (const t of query.data.traits) {
    if (t.effects && t.effects.length > 0) traitMap.set(t.id, t.effects);
  }
  const skillMap = new Map<string, ReadonlyArray<TraitEffect>>();
  for (const s of query.data.skills) {
    if (s.effects && s.effects.length > 0) skillMap.set(s.id, s.effects);
  }
  return {
    libraryTraitEffects: traitMap,
    librarySkillEffects: skillMap,
    isLoading: false,
  };
}
