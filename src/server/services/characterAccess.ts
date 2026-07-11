/**
 * Single entry point for "what can `viewerId` see of this character?"
 *
 * Three call sites used to answer this question independently:
 * `decideCharacterAccess` (routes/sync.ts) — the canonical, pure
 * full-vs-minimal decision, unit-tested but deliberately silent on
 * membership (it assumes its inputs were already filtered to campaigns
 * the viewer belongs to); `shouldUseMinimalView` (routes/characters.ts)
 * — a boolean wrapper around the same decision for `GET
 * /characters/{id}`; and an inline block in routes/history.ts that
 * additionally had to perform the membership check `decideCharacterAccess`
 * skips. Two ad hoc re-derivations of a share-gate decision is exactly
 * what AGENTS.md's share-gate invariant warns against — this module is
 * the one place that owns the full flow.
 */

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.ts';
import { campaignMemberships, campaigns } from '../db/schema.ts';
import { decideCharacterAccess } from '../routes/sync.ts';

export type CharacterViewLevel = 'full' | 'minimal' | 'forbidden';

export interface CharacterViewInput {
  readonly id: string;
  readonly ownerId: string;
  readonly campaignId: string | null;
}

/**
 * Resolve the access level `viewerId` has for `character`:
 *
 *   1. The owner always gets `'full'`.
 *   2. A non-owner with no parent campaign has no path to the
 *      character at all — `'forbidden'`.
 *   3. Otherwise load the parent campaign and the viewer's membership
 *      row; a non-member (and non-GM) is `'forbidden'`.
 *   4. A member (or the campaign GM) gets the full-vs-minimal choice
 *      from `decideCharacterAccess` — never re-derived here.
 *
 * Callers that need a 403-vs-404 distinction, or that already gated
 * read access some other way (e.g. `loadCharacterOr403`), interpret
 * `'forbidden'` however their route requires; this function only
 * reports the access level.
 */
export async function resolveCharacterView(
  viewerId: string,
  character: CharacterViewInput,
): Promise<CharacterViewLevel> {
  if (character.ownerId === viewerId) return 'full';
  if (!character.campaignId) return 'forbidden';

  const db = getDb();
  const [camp] = await db
    .select({
      id: campaigns.id,
      ownerId: campaigns.ownerId,
      shareCharacterSheets: campaigns.shareCharacterSheets,
    })
    .from(campaigns)
    .where(eq(campaigns.id, character.campaignId));
  if (!camp) return 'forbidden';

  const isCampaignOwner = camp.ownerId === viewerId;
  if (!isCampaignOwner) {
    const [membership] = await db
      .select({ userId: campaignMemberships.userId })
      .from(campaignMemberships)
      .where(
        and(
          eq(campaignMemberships.campaignId, character.campaignId),
          eq(campaignMemberships.userId, viewerId),
        ),
      );
    if (!membership) return 'forbidden';
  }

  const mode = decideCharacterAccess({
    viewerId,
    characters: [character],
    campaigns: [camp],
  }).get(character.id);
  return mode ?? 'forbidden';
}
