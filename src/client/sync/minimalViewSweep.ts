/**
 * Local enforcement of the campaign-share gate. Mirrors the server's
 * `decideCharacterAccess` helper: when a character is in a campaign
 * with `shareCharacterSheets=false` and the viewer is neither the
 * character's owner nor the campaign's GM, we wipe its private child
 * rows from Dexie.
 *
 * Why this exists: `/sync/cursor` stops emitting child upserts the
 * moment the GM flips share off, but already-cached traits / skills /
 * inventory / combat rows would otherwise stay reachable in IndexedDB.
 * Codex review on PR #22: "the current gate prevents new private rows
 * but leaves stale private rows recoverable after access is downgraded
 * to minimal." This sweep closes that hole.
 *
 * The sweep runs:
 *   1. After every `/sync/cursor` pull (so a fresh share=false flip
 *      lands on the next sync tick at latest).
 *   2. On bootstrap (so a re-install / new device on a campaign that
 *      already has share=false starts clean).
 *
 * The helper here is pure — it computes WHICH character ids should be
 * minimal — so the orchestrator can call it without spinning up Dexie
 * in tests.
 */

export interface SweepInputCharacter {
  readonly id: string;
  readonly ownerId: string;
  readonly campaignId: string | null;
}

export interface SweepInputCampaign {
  readonly id: string;
  readonly ownerId: string;
  /**
   * Optional in the schema for backward compat with Dexie rows written
   * before the column existed; treat absent as `true` (full sharing on,
   * which is the schema default).
   */
  readonly shareCharacterSheets?: boolean;
}

/**
 * Returns the set of character ids whose private child rows the local
 * viewer should NOT see and therefore should be purged from Dexie.
 */
export function characterIdsToMinimize(args: {
  viewerId: string;
  characters: readonly SweepInputCharacter[];
  campaigns: readonly SweepInputCampaign[];
}): Set<string> {
  const campaignById = new Map<string, SweepInputCampaign>();
  for (const c of args.campaigns) campaignById.set(c.id, c);

  const out = new Set<string>();
  for (const ch of args.characters) {
    if (ch.ownerId === args.viewerId) continue;
    if (ch.campaignId === null) continue;
    const camp = campaignById.get(ch.campaignId);
    if (!camp) continue;
    if (camp.ownerId === args.viewerId) continue; // GM sees everything
    if (camp.shareCharacterSheets === false) out.add(ch.id);
  }
  return out;
}
