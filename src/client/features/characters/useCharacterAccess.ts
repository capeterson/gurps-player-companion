/**
 * Single source for the client-side character access decision:
 * who may edit this sheet, and whether the viewer gets the minimal
 * (share-gated) view instead of the full sheet.
 *
 * Mirrors the server-side gate in `shouldUseMinimalView` so the
 * local-first path renders consistently with the API contract
 * (AGENTS.md: the share gate must be single-sourced — never re-derive
 * it ad hoc).
 *
 * Safe to call before the character has loaded: pass `undefined`/
 * `null` and every flag degrades to "no access decision yet"
 * (canWrite/isMinimal false). This keeps the hook callable
 * unconditionally, ahead of any loading/not-found early returns.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { type LocalCampaign, getLocalDb } from '../../db/dexie.ts';
import { readUserIdFromToken } from '../../lib/tokenStore.ts';

export interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  pointTarget: number | null;
  disadvantageCap: number | null;
  quirkCap: number | null;
  manaLevel: 'none' | 'low' | 'normal' | 'high' | 'very_high';
  shareCharacterSheets: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface CharacterAccess {
  /** Resolved current-user id (from /auth/me or the local JWT). */
  readonly myId: string | null;
  /** True when the viewer owns the character. */
  readonly isOwner: boolean;
  /** True when the viewer is the GM (owner) of the character's campaign. */
  readonly isGm: boolean;
  /** True when the viewer may edit the sheet. */
  readonly canWrite: boolean;
  /** True when the share gate demands the minimal (readily-apparent) view. */
  readonly isMinimal: boolean;
  /** The character's campaign row, when known. */
  readonly campaign: CampaignSummary | undefined;
}

export function useCharacterAccess(
  character: CharacterDetail | null | undefined,
  campaigns: CampaignSummary[] | undefined,
  meId: string | null | undefined,
): CharacterAccess {
  // Fall back to the local JWT sub when the /auth/me query hasn't resolved
  // yet (offline, cold cache, or first render) so the sheet is editable
  // while offline for the character's owner.
  const myId = meId ?? readUserIdFromToken();

  const campaign = character ? campaigns?.find((c) => c.id === character.campaignId) : undefined;

  const isOwner = character != null && myId !== null && myId === character.ownerId;
  const canWrite = isOwner;

  // Minimal-view gate: when the character belongs to a campaign that
  // has flipped `shareCharacterSheets` off, members other than the
  // character's owner and the campaign GM see only the "readily
  // apparent" identity bits. Owners and GMs always see the full sheet.
  const isGm = myId !== null && campaign != null && myId === campaign.ownerId;
  const sharesSheets = campaign?.shareCharacterSheets !== false; // undefined → default true
  const isMinimal = character != null && !isOwner && !isGm && campaign != null && !sharesSheets;

  return { myId, isOwner, isGm, canWrite, isMinimal, campaign };
}

function toCampaignSummary(row: LocalCampaign): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    pointTarget: row.pointTarget,
    disadvantageCap: row.disadvantageCap,
    quirkCap: row.quirkCap,
    // Both fields are optional on `LocalCampaign` for backwards
    // compatibility with rows synced before the column existed; the
    // safe defaults mirror the ones this file already applies when the
    // field is missing (see `sharesSheets`/mana-level fallbacks above).
    manaLevel: row.manaLevel ?? 'normal',
    shareCharacterSheets: row.shareCharacterSheets ?? true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

export interface CharacterAccessLocal extends CharacterAccess {
  /**
   * True while the share-gate decision for a non-owner is undecided
   * because the character belongs to a campaign whose local Dexie row
   * hasn't loaded yet. Callers MUST hold their loading state (not
   * render full content) while this is true — rendering before the
   * gate resolves is exactly the bug this hook exists to prevent (see
   * AGENTS.md: "the share gate applies to EVERY payload carrying
   * character data").
   */
  readonly accessPending: boolean;
}

/**
 * Local-first variant of `useCharacterAccess`: reads campaign rows from
 * Dexie (via `useLiveQuery`) instead of requiring the caller to thread
 * through a REST `/campaigns` query. Dexie already carries the
 * campaign rows the sync cursor pulls read-only (AGENTS.md rule S0),
 * so the share-gate decision is available offline / on a cold cache
 * without waiting on the network.
 *
 * Callers that also need the *full* campaign list for UI unrelated to
 * the access decision (e.g. a campaign picker) should keep their own
 * REST `useQuery('/campaigns')` — that fetch continues to feed
 * `useMirrorCampaigns` as the online refresher for this Dexie table;
 * it is unrelated to (and unchanged by) this hook.
 */
export function useCharacterAccessLocal(
  character: CharacterDetail | null | undefined,
  meId: string | null | undefined,
): CharacterAccessLocal {
  // `undefined` while the live query is still mounting (or the very
  // first Dexie read hasn't resolved); a resolved (possibly empty)
  // array afterwards. Distinguishing the two is the whole point here.
  const localCampaigns = useLiveQuery(() => getLocalDb().campaigns.toArray(), []);

  const campaigns = useMemo(() => localCampaigns?.map(toCampaignSummary), [localCampaigns]);

  const access = useCharacterAccess(character, campaigns, meId);

  // Ownership never depends on the campaign row -- derive it the same
  // way `useCharacterAccess` does so an owner's own sheet is never
  // held up by a cold campaigns cache (owners must stay fully usable
  // offline).
  const myId = meId ?? readUserIdFromToken();
  const isOwner = character != null && myId !== null && myId === character.ownerId;

  // Hold the gate only for a non-owner whose character actually
  // belongs to a campaign, and only until the Dexie campaigns table
  // has resolved at least once. `localCampaigns === undefined` means
  // "still loading" -- hold. Once it resolves to an array, a missing
  // row for this campaignId means the campaign is genuinely unknown on
  // this device (never synced, or deleted); that's the pre-existing
  // behaviour this hook preserves as-is (a non-owner in that state
  // relies on the server having already masked the character row
  // itself, since a real campaign's `shareCharacterSheets` would have
  // synced down via the cursor before the character row did).
  const accessPending = !isOwner && character?.campaignId != null && localCampaigns === undefined;

  return { ...access, accessPending };
}
