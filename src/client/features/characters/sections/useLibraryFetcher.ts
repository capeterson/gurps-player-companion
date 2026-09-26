import { useCallback } from 'react';
import type { ActiveEffectDefinitionOut } from '../../../../shared/schemas/activeEffects.ts';
import type {
  LibraryEnchantmentOut,
  LibraryItemOut,
  LibraryLanguageOut,
  LibrarySkillOut,
  LibrarySpellOut,
  LibraryTechniqueOut,
  LibraryTraitOut,
} from '../../../../shared/schemas/campaignLibrary.ts';
import type { LibraryEntityClass } from '../../../../shared/schemas/sync.ts';
import { syncEntityTable } from '../../../db/syncEntityStore.ts';

/**
 * `fetchOptions(query)` for `<LibraryAutocomplete>`, reading the campaign's
 * sync-backed library straight from Dexie (AGENTS.md S0), so picking a
 * library entry works offline and never waits on the network.
 *
 * Filtering is client-side because campaign libraries are typically
 * dozens to hundreds of entries — fast enough to substring-match in
 * the browser without server-side search infrastructure.
 *
 * Returns always-empty options when the character is not attached to a
 * campaign, so the autocomplete just acts as a plain input.
 */

type Kind =
  | 'traits'
  | 'skills'
  | 'spells'
  | 'items'
  | 'languages'
  | 'techniques'
  | 'enchantments'
  | 'activeEffects';

type LibraryEntry =
  | LibraryTraitOut
  | LibrarySkillOut
  | LibrarySpellOut
  | LibraryItemOut
  | LibraryLanguageOut
  | LibraryTechniqueOut
  | LibraryEnchantmentOut
  | ActiveEffectDefinitionOut;

const ENTITY_CLASS: Record<Kind, LibraryEntityClass> = {
  traits: 'campaign_library_trait',
  skills: 'campaign_library_skill',
  spells: 'campaign_library_spell',
  items: 'campaign_library_item',
  languages: 'campaign_library_language',
  techniques: 'campaign_library_technique',
  enchantments: 'campaign_library_enchantment',
  activeEffects: 'campaign_library_active_effect',
};

export function useLibraryFetcher<T extends LibraryEntry>(
  kind: Kind,
  campaignId: string | null,
): {
  fetchOptions: (query: string) => Promise<T[]>;
  isLoading: boolean;
} {
  const fetchOptions = useCallback(
    async (q: string): Promise<T[]> => {
      if (!campaignId) return [];
      const table = syncEntityTable(ENTITY_CLASS[kind]);
      // The caller's `T` is one of the union members; the kind arg
      // discriminates which store we read. TS can't narrow through that
      // mapping, so this cast is necessary at the boundary.
      const list = ((await table?.where('campaignId').equals(campaignId).toArray()) ??
        []) as unknown as T[];
      if (q.length === 0)
        return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
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
    [kind, campaignId],
  );

  return { fetchOptions, isLoading: false };
}
