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

import type { CharacterDetail } from '../../../shared/schemas/character.ts';
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
