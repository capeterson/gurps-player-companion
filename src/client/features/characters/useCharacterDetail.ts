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
import { readUserIdFromToken } from '../../lib/tokenStore.ts';

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
    // Per docs/specs/campaign-content-sharing.md: a character the viewer
    // may only see in minimal form is NOT listed on the "your
    // characters" page — those rows are discoverable from the campaign
    // detail page instead. The local-first row stays in Dexie so the
    // minimal-view detail page (CharacterMinimalView) can render
    // offline; here we exclude any row not owned by the current user,
    // which covers:
    //   - characters in a campaign with shareCharacterSheets=true that
    //     the viewer is a member of (they'd see the full sheet on
    //     /characters/:id, but the roster browse surface stays the
    //     campaign page),
    //   - minimal-view characters (other players' sheets in a
    //     share=false campaign),
    //   - stale rows from a previous session that lost their campaign
    //     association.
    // The token sub is set at login; if it's missing (logged out /
    // cold boot before the bootstrap gate resolves) we return nothing
    // so the page doesn't briefly flash rows the viewer can't own.
    const myId = readUserIdFromToken();
    return rows
      .filter((r) => myId !== null && r.ownerId === myId)
      .map<CharacterListItem>((r) => ({
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

/**
 * Campaign roster for `/campaigns/:id`'s browseable "Characters"
 * section. Returns every character in the campaign Dexie knows about,
 * regardless of the share gate — minimal viewers deep-link to
 * `/characters/:id` which renders CharacterMinimalView for them; full
 * viewers (owner / GM / share=true member) land on the full sheet.
 *
 * Reads Dexie (local-first) so the roster stays available offline.
 * Member-owned characters that the orchestrator hasn't synced down yet
 * simply don't appear until the next cursor pull — same trade-off as
 * `useCharactersList`.
 */
export function useCampaignCharactersList(campaignId: string | undefined): CharacterListResult {
  return useLiveQuery(async () => {
    if (!campaignId) return [];
    const db = getLocalDb();
    const rows = await db.characters
      .where('campaignId')
      .equals(campaignId)
      .reverse()
      .sortBy('updatedAt');
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
  }, [campaignId]);
}
