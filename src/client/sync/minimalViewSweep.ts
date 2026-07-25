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
  readonly allowGmCharacterEditing?: boolean;
  readonly viewerRole?: 'owner' | 'manager' | 'member';
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
    if (camp.allowGmCharacterEditing && camp.viewerRole === 'manager') continue;
    if (camp.shareCharacterSheets === false) out.add(ch.id);
  }
  return out;
}

/** The local character rows a viewer can still see, and which are masked. */
export interface LocalCharacterAccess {
  /** Ids of character rows present in Dexie. */
  readonly known: ReadonlySet<string>;
  /**
   * Ids the viewer may not see in full: masked by the share-gate sweep,
   * or retained-but-revoked (`accessRevoked`) because an unsettled op
   * blocked the prune. Build it with `characterAccessFrom` so both
   * sources are always included.
   */
  readonly masked: ReadonlySet<string>;
}

/** The character-row fields the access snapshot needs. */
export interface AccessInputCharacter {
  readonly id: string;
  readonly minimalViewMasked?: boolean | undefined;
  readonly accessRevoked?: boolean | undefined;
}

/**
 * Build the access snapshot every share-gate read uses.  Single helper
 * so no caller can forget one of the two ways a character stops being
 * fully visible.
 */
export function characterAccessFrom(
  characters: readonly AccessInputCharacter[],
): LocalCharacterAccess {
  return {
    known: new Set(characters.map((c) => c.id)),
    masked: new Set(
      characters.filter((c) => c.minimalViewMasked || c.accessRevoked).map((c) => c.id),
    ),
  };
}

/**
 * The parts of a row this decision needs.  Fields are optional because
 * journal entries for whole-cycle failures carry no entity at all.
 */
export interface OutboxAccessSubject {
  readonly entityClass?: string | undefined;
  readonly entityId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly command?: string | undefined;
}

/**
 * Should the share gate hide a queued op's `prevValue` / `attemptedValue`?
 *
 * The outbox is deliberately never swept — a queued op is the user's own
 * unsent intent and still has to be delivered, and
 * `pruneInaccessibleLocally` refuses to prune an entity with unsettled
 * ops. So every surface that *prints* those values applies this instead.
 * It lives here, next to the sweep it mirrors, because it was duplicated
 * in the sync dialog and the debug dump and those must not drift.
 *
 * A masked character always restricts. A **missing** character row means
 * something different depending on the op:
 *   - child op (`parentId` set): the parent going away is access loss,
 *     whatever the command. A `delete` matters most here — `enqueueDelete`
 *     stores the entire removed row in `prevValue`, so a GM deleting
 *     another player's trait leaves that whole row queued.
 *   - root `character` op: the row is *expected* to be gone after a local
 *     delete, and a speculative create may not have landed, so only a
 *     `patch` implies lost access.
 */
export function isOutboxAccessRestricted(
  op: OutboxAccessSubject,
  access: LocalCharacterAccess,
): boolean {
  const characterId = op.parentId ?? (op.entityClass === 'character' ? op.entityId : undefined);
  if (!characterId) return false;
  if (access.masked.has(characterId)) return true;
  if (access.known.has(characterId)) return false;
  if (op.parentId !== undefined) return true;
  return op.command === 'patch';
}

/**
 * The same decision applied at **read time** to anything that has
 * already been written down — journal entries, rejection records.
 *
 * `redactSyncLogForCharacters` scrubs those at rest when a sweep runs,
 * but a sweep only runs after a successful cursor pull. A user-triggered
 * revert performed **offline** writes a fresh snapshot after the sweep
 * has already been and gone, and offline means no later pull to scrub
 * it. Checking at read time closes that window and covers every future
 * write path for free.
 */
export function isRecordAccessRestricted(
  record: OutboxAccessSubject & { readonly redacted?: boolean | undefined },
  access: LocalCharacterAccess,
): boolean {
  if (record.redacted) return true;
  const characterId =
    record.parentId ?? (record.entityClass === 'character' ? record.entityId : undefined);
  if (!characterId) return false;
  if (access.masked.has(characterId)) return true;
  // A child record whose parent character is gone: `pruneInaccessible-
  // Locally` matches dirty ops by entityId only, so a queued CHILD op
  // does not protect its parent row from being pruned. Reverting that
  // child offline then writes a fresh snapshot naming a character the
  // viewer can no longer see, with no later pull to redact it.
  if (record.parentId !== undefined) return !access.known.has(record.parentId);
  // A root record's own entity may legitimately be long deleted, so a
  // missing row there is not on its own evidence of lost access.
  return false;
}
