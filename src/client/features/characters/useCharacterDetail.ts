/**
 * Reactive read hooks backed by Dexie via `useLiveQuery`.
 *
 * These replace the prior `useQuery({ queryFn: () => api(...) })`
 * pattern.  The orchestrator keeps Dexie in sync with the server in
 * the background; the UI reads only from Dexie.  When a row changes
 * (locally via outbox.enqueue, or via /sync/cursor pull), Dexie
 * re-fires the live query and the component re-renders.
 *
 * Derived stats (HP, FP, basic lift, skill levels, encumbrance,
 * warnings) are computed client-side via the shared domain code so
 * they match the server's `/characters/{id}` response byte-for-byte.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { buildCharacterDetail } from '../../../shared/domain/characterDetail.ts';
import type { CharacterDetail, CharacterListItem } from '../../../shared/schemas/character.ts';
import type { TraitEffect } from '../../../shared/schemas/effects.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useLibraryEffectMaps } from './useLibraryEffectMaps.ts';

/**
 * `undefined` while the live query is still mounting; `null` for
 * "character not found in local Dexie".  Callers should distinguish
 * the two to avoid showing a "not found" page during the initial
 * Dexie open.
 */
export type CharacterDetailResult = CharacterDetail | null | undefined;

export interface UseCharacterDetailOptions {
  /**
   * Library trait id → effects[] map.  When omitted (the default), the
   * hook fetches the campaign library itself via `useLibraryEffectMaps`
   * and joins effects automatically.  Pass an explicit map here only if
   * you need to override the auto-fetch (e.g. in tests).
   */
  readonly libraryTraitEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  readonly librarySkillEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
}

export function useCharacterDetail(
  id: string | undefined,
  options: UseCharacterDetailOptions = {},
): CharacterDetailResult {
  // Pre-fetch the campaignId so the library hook can run with the
  // correct key.  Two live queries are cheap; the second depends on the
  // library maps which themselves depend on this campaignId.
  const campaignId = useLiveQuery(async () => {
    if (!id) return null;
    const c = await getLocalDb().characters.get(id);
    return c?.campaignId ?? null;
  }, [id]);

  const autoMaps = useLibraryEffectMaps(campaignId ?? null);
  const traitEffects = options.libraryTraitEffects ?? autoMaps.libraryTraitEffects;
  const skillEffects = options.librarySkillEffects ?? autoMaps.librarySkillEffects;
  return useLiveQuery(async () => {
    if (!id) return null;
    const db = getLocalDb();
    const character = await db.characters.get(id);
    if (!character) return null;
    const [traits, skills, spells, inventory, combat, campaign] = await Promise.all([
      db.characterTraits.where({ characterId: id }).sortBy('name'),
      db.characterSkills.where({ characterId: id }).sortBy('name'),
      db.characterSpells.where({ characterId: id }).sortBy('name'),
      db.characterInventory.where({ characterId: id }).sortBy('name'),
      db.characterCombat.get(id),
      character.campaignId ? db.campaigns.get(character.campaignId) : Promise.resolve(undefined),
    ]);
    return buildCharacterDetail({
      character,
      traits: traits.map((t) => ({
        ...t,
        libraryEffects:
          t.libraryTraitId && traitEffects?.has(t.libraryTraitId)
            ? [...(traitEffects.get(t.libraryTraitId) ?? [])]
            : [],
      })),
      skills: skills.map((s) => ({
        ...s,
        libraryEffects:
          s.librarySkillId && skillEffects?.has(s.librarySkillId)
            ? [...(skillEffects.get(s.librarySkillId) ?? [])]
            : [],
      })),
      spells,
      inventory,
      combat: combat ?? null,
      campaign: campaign
        ? {
            pointTarget: campaign.pointTarget,
            disadvantageCap: campaign.disadvantageCap,
            quirkCap: campaign.quirkCap,
            manaLevel: campaign.manaLevel ?? 'normal',
          }
        : null,
    });
    // The maps are memoized on the library query's data (see
    // useLibraryEffectMaps), so their identity changes exactly when the
    // library payload does — including value-only edits a size-based
    // key would miss.
  }, [id, traitEffects, skillEffects]);
}

export type CharacterListResult = CharacterListItem[] | undefined;

export function useCharactersList(): CharacterListResult {
  return useLiveQuery(async () => {
    const db = getLocalDb();
    // Dexie's orderBy uses the index; we want descending updatedAt so
    // the most recently touched character is at the top, matching the
    // server's GET /characters behaviour.
    const rows = await db.characters.orderBy('updatedAt').reverse().toArray();
    return rows.map<CharacterListItem>((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      campaignId: r.campaignId,
      name: r.name,
      playerName: r.playerName,
      techLevel: r.techLevel,
      st: r.st,
      dx: r.dx,
      iq: r.iq,
      ht: r.ht,
      updatedAt: r.updatedAt,
      revision: Math.max(0, r.revision),
    }));
  }, []);
}
