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
import { getLocalDb } from '../../db/dexie.ts';

/**
 * `undefined` while the live query is still mounting; `null` for
 * "character not found in local Dexie".  Callers should distinguish
 * the two to avoid showing a "not found" page during the initial
 * Dexie open.
 */
export type CharacterDetailResult = CharacterDetail | null | undefined;

export function useCharacterDetail(id: string | undefined): CharacterDetailResult {
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
      traits,
      skills,
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
  }, [id]);
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
