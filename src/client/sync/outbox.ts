/**
 * Outbox: the durable queue of pending mutations.
 *
 * `enqueueOp` writes the local entity row AND the outbox entry inside
 * one Dexie transaction so a mutation is either fully durable
 * (visible in `useLiveQuery` AND queued for replay) or not at all.
 *
 * Coalescing (AGENTS.md rule 1): when a safe-to-replace `pending` or
 * server-confirmed transient patch exists for the same field, we delete it
 * and insert the latest value. A delivery-uncertain retry is retained as an
 * ordered predecessor because the server may already have applied it.
 * `create` and `delete` are never coalesced.
 */

import { type LibraryMechanics, libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import {
  type EntityClass,
  type LibraryEntityClass,
  type OperationCommand,
  isLibraryEntityClass,
} from '../../shared/schemas/sync.ts';
import { type OutboxEntry, type OutboxStatus, coalesceKey, getLocalDb } from '../db/dexie.ts';
import {
  deleteSyncEntity,
  readSyncEntity,
  syncEntityTable,
  updateSyncEntity,
  writableSyncEntityTable,
} from '../db/syncEntityStore.ts';
import {
  campaignTransferStores,
  detachLocalCampaignReferences,
  mergeCampaignTransferUndo,
  restoreLocalCampaignReferences,
} from './localCampaignTransfer.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROKEN_FALLBACK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{0,3}-8[0-9a-f]{0,3}-[0-9a-f]{12}$/i;

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Generate an RFC 4122 UUID for local entity, operation, and batch identity. */
export function newClientId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    const id = runtimeCrypto.randomUUID();
    if (UUID_RE.test(id)) return id;
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === 'function') {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    // Very old/non-browser environments still need a structurally valid id.
    // These ids are deduplication keys, not authentication secrets.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return formatUuidV4(bytes);
}

function wasGeneratedByBrokenUuidFallback(value: string | undefined): value is string {
  return value !== undefined && !UUID_RE.test(value) && BROKEN_FALLBACK_UUID_RE.test(value);
}

export interface EnqueueFieldPatchArgs {
  /** Internal retry metadata; never part of the wire value. */
  readonly localCampaignTransferUndo?: OutboxEntry['localCampaignTransferUndo'];
  /** Internal stale-base replay retains the current assignment generation. */
  readonly preserveCampaignCreateDependencies?: boolean;
  readonly entityClass: EntityClass;
  readonly entityId: string;
  readonly fieldPath: string;
  readonly attemptedValue: unknown;
  /**
   * Optional explicit prev-value override.  When omitted (the common
   * case) `enqueueFieldPatch` reads the field's current value from
   * Dexie inside the transaction so a server rejection can rollback
   * cleanly without the caller having to track the prior value.
   */
  readonly prevValue?: unknown;
  readonly baseRevision?: number | undefined;
  readonly humanName?: string | undefined;
  readonly flashKey?: string | undefined;
  /** Optional parent for child entity classes (trait/skill/inventory/combat). */
  readonly characterId?: string | undefined;
  /** Groups mutations from one user gesture for history fold-grouping. */
  readonly batchId?: string | undefined;
  /** Optional local-only deadline before this operation may be sent. */
  readonly nextEarliestAttemptAt?: string | undefined;
}

/**
 * Patch one field on one entity.  Coalesces against any pending patch
 * for the same (entityId, fieldPath).
 */
export async function enqueueFieldPatch(args: EnqueueFieldPatchArgs): Promise<void> {
  await enqueueFieldPatches([args]);
}

/** One gesture's fields become durable together. Each retains its raw value,
 * coalescing key and rollback/flash behavior; batchId groups their audit history.
 */
export async function enqueueFieldPatches(
  patches: readonly EnqueueFieldPatchArgs[],
): Promise<void> {
  if (patches.length === 0) return;
  const db = getLocalDb();
  const batchId = patches.length > 1 ? newBatchId() : undefined;
  const stores = patches.flatMap((args) =>
    storesForOp(args.entityClass).map((store) => store.name),
  );
  await db.transaction('rw', [db.outbox, ...stores], async () => {
    for (const args of patches) {
      await enqueueFieldPatchInTransaction({ ...args, batchId: args.batchId ?? batchId });
    }
  });
}

async function enqueueFieldPatchInTransaction(input: EnqueueFieldPatchArgs): Promise<void> {
  let args = input;
  if (args.entityClass === 'character' && args.fieldPath === 'campaignId') {
    args = {
      ...args,
      attemptedValue:
        typeof args.attemptedValue === 'string'
          ? args.attemptedValue.toLowerCase()
          : args.attemptedValue,
      prevValue: typeof args.prevValue === 'string' ? args.prevValue.toLowerCase() : args.prevValue,
    };
  }
  const db = getLocalDb();
  const ckey = coalesceKey(args.entityId, args.fieldPath);
  const now = new Date().toISOString();
  // 1. Find any pending/transient_retry op(s) for the same field so we
  //    can coalesce them away -- AND, critically, carry forward the
  //    OLDEST one's prevValue instead of re-reading the local row.
  //    Bug this guards against (PR #46 review): the local row already
  //    holds the about-to-be-deleted op's optimistic attemptedValue,
  //    so reading "current local value" here would capture that
  //    unsynced intermediate value as the surviving op's prevValue.
  //    If the surviving op is later rejected, the orchestrator writes
  //    prevValue straight back into the row (S2) -- rolling back to a
  //    value the server never actually had, which then only heals on
  //    a later cursor pull (S4's pending-op skip no longer protects
  //    it once the outbox row is gone). Carrying forward the oldest
  //    delete's prevValue keeps rollback anchored to the last
  //    server-confirmed value through any number of coalesced taps.
  //    Affects every rapid-tap surface that patches a field more than
  //    once in quick succession (conditions toggles, pool bumpers,
  //    temp-effect steppers).
  const dupes = await db.outbox.where('coalesceKey').equals(ckey).toArray();
  if (
    args.entityClass === 'character' &&
    args.fieldPath === 'campaignId' &&
    !args.preserveCampaignCreateDependencies &&
    !dupes.some((op) => ['pending', 'in_flight', 'transient_retry'].includes(op.status))
  ) {
    // A new assignment generation starts only after the previous one settled.
    // Existing creates now belong before this move, even if they originally
    // waited for the previous assignment. Reclassify in the enqueue transaction
    // so a drain can never observe the new move with stale dependency flags.
    await db.outbox
      .filter(
        (op) =>
          op.command === 'create' &&
          op.parentId === args.entityId &&
          op.localWaitForCampaignAssignment === true,
      )
      .modify({ localWaitForCampaignAssignment: false });
  }
  const { coalescable, carriedPrev, predecessorClientOpId } = await coalesceSameKeyOps(dupes);
  let localCampaignTransferUndo = args.localCampaignTransferUndo;
  for (const entry of coalescable) {
    localCampaignTransferUndo = mergeCampaignTransferUndo(
      localCampaignTransferUndo,
      entry.localCampaignTransferUndo,
    );
  }

  // 2. prevValue precedence: an explicit caller override always wins
  //    (e.g. the orchestrator's stale_base self-heal passes the
  //    server-confirmed current value when refreshing a superseding
  //    op -- see orchestrator.ts's `newerPending` branch, which
  //    applies the exact same "carry the true original value forward"
  //    idea by hand). Otherwise carry forward the root coalesced op's
  //    prevValue. Only when nothing was pending for this field
  //    do we fall back to reading the local row fresh -- there's
  //    nothing to coalesce, so the local row's current value IS the
  //    last-synced value.
  // null is a confirmed empty field (e.g. armor before its first edit),
  // not a missing override. Losing it makes a second stale-base retry
  // compare the server against our optimistic value and falsely roll back.
  let prev =
    args.prevValue !== undefined
      ? args.prevValue
      : carriedPrev
        ? carriedPrev.value
        : await readFieldValue(args);
  if (
    args.entityClass === 'character' &&
    args.fieldPath === 'campaignId' &&
    typeof prev === 'string'
  )
    prev = prev.toLowerCase();
  // baseRevision does NOT need the same carry-forward treatment:
  // applyLocalPatch (step 3 below) only ever touches `fieldPath` and
  // `updatedAt` on the local row, never `revision` -- local writes
  // don't bump it. So re-reading the local row's revision here
  // returns exactly the same last-known-server revision the coalesced
  // op captured, unless a cursor pull landed a newer one in between,
  // in which case picking up the fresher revision is correct, not a
  // bug.
  const baseRev = args.baseRevision ?? (await readEntityRevision(args));
  if (args.entityClass === 'character' && args.fieldPath === 'campaignId') {
    const current = await db.characters.get(args.entityId);
    if (current && (current.campaignId?.toLowerCase() ?? null) !== args.attemptedValue) {
      localCampaignTransferUndo = mergeCampaignTransferUndo(
        localCampaignTransferUndo,
        await detachLocalCampaignReferences(
          args.entityId,
          current.campaignId?.toLowerCase() ?? null,
        ),
      );
    }
    // A coalesced return to the unchanged server campaign cancels the detach.
    if (args.attemptedValue === prev && !dupes.some((op) => op.status === 'in_flight'))
      await restoreLocalCampaignReferences(localCampaignTransferUndo ?? [], prev);
  }

  // 3. Apply the local row mutation immediately so `useLiveQuery`
  //    sees the user's typed value before the server even hears
  //    about it.  For child entities we need to know which parent
  //    table to touch -- the entityClass alone tells us.
  await applyLocalPatch(args);
  // 4. Insert the outbox row last so any rollback of step 3 (Dexie
  //    transaction abort) also drops the queued op.
  const op: OutboxEntry = {
    clientOpId: newClientId(),
    entityClass: args.entityClass,
    entityId: args.entityId,
    command: 'patch',
    coalesceKey: ckey,
    fieldPath: args.fieldPath,
    // attemptedValue is the raw new field value -- wrapping it with
    // a parent hint here would mean the orchestrator's rollback
    // path (which writes prevValue back into the local row) would
    // need to know to unwrap.  Carry the parent on `parentId`
    // instead so attemptedValue / prevValue stay primitive.
    attemptedValue: args.attemptedValue,
    prevValue: prev,
    baseRevision: baseRev,
    parentId: parentIdFor(args.entityClass, args.characterId, args.entityId),
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: now,
    attemptCount: 0,
    humanName: args.humanName,
    flashKey: args.flashKey,
    batchId: args.batchId,
    nextEarliestAttemptAt: args.nextEarliestAttemptAt,
    predecessorClientOpId,
    localCampaignTransferUndo,
  };
  await db.outbox.add(op);
}

/**
 * Coalesce the outbox rows that share one coalesce key (AGENTS.md S3).
 *
 * Safe-to-replace rows (`pending`, or a server-confirmed transient retry) are
 * deleted, and the ROOT one's prevValue is carried forward so a later
 * rollback lands on the last server-confirmed value rather than on an
 * unsynced intermediate. A delivery-uncertain row may already have been
 * applied, so it stays queued as the successor's ordered predecessor.
 * Callers must run inside the enqueue transaction.
 */
async function coalesceSameKeyOps(dupes: readonly OutboxEntry[]): Promise<{
  coalescable: OutboxEntry[];
  carriedPrev: { value: unknown } | undefined;
  predecessorClientOpId: string | undefined;
}> {
  const coalescable = dupes.filter(
    (d) =>
      d.status === 'pending' || (d.status === 'transient_retry' && d.deliveryUncertain === false),
  );
  const predecessors = dupes.filter(
    (d) =>
      d.status === 'in_flight' || (d.status === 'transient_retry' && d.deliveryUncertain !== false),
  );
  let carriedPrev: { value: unknown } | undefined;
  let predecessorClientOpId = [...predecessors]
    .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt))
    .at(-1)?.clientOpId;
  if (coalescable.length > 0) {
    // A confirmed-transient predecessor and its pending successor can both
    // become safe to replace. Follow their ancestry rather than trusting wall
    // clock order, which can tie or move backward.
    const coalescableIds = new Set(coalescable.map((entry) => entry.clientOpId));
    const roots = coalescable.filter(
      (entry) => !entry.predecessorClientOpId || !coalescableIds.has(entry.predecessorClientOpId),
    );
    const baselineCandidates = roots.length > 0 ? roots : coalescable;
    const baselineRoot = baselineCandidates.reduce((a, b) =>
      a.enqueuedAt < b.enqueuedAt || (a.enqueuedAt === b.enqueuedAt && a.clientOpId <= b.clientOpId)
        ? a
        : b,
    );
    carriedPrev = { value: baselineRoot.prevValue };
    predecessorClientOpId ??= baselineRoot.predecessorClientOpId;
  }
  const db = getLocalDb();
  for (const d of coalescable) {
    await db.outbox.delete(d.clientOpId);
  }
  return { coalescable, carriedPrev, predecessorClientOpId };
}

export interface EnqueueEntityPatchArgs {
  readonly entityClass: LibraryEntityClass;
  readonly entityId: string;
  /** Owning campaign; carried as the envelope's `parentId`. */
  readonly campaignId: string;
  /**
   * The entry's full update body. The server validates it as one unit, and
   * every key stays protected from cursor overwrites until the op settles.
   */
  readonly attemptedValue: Record<string, unknown>;
  /**
   * Server-confirmed baseline override, used by the orchestrator's
   * stale-base resend. Normally read from the coalesced root or local row.
   */
  readonly prevValue?: Record<string, unknown> | undefined;
  readonly baseRevision?: number | undefined;
  readonly humanName?: string | undefined;
  readonly batchId?: string | undefined;
}

/**
 * Whole-entry patch (AGENTS.md S13) for entities edited as one form whose
 * fields the server validates together. Same durability, coalescing and
 * predecessor rules as `enqueueFieldPatch`; `prevValue` is the full row.
 */
export async function enqueueEntityPatch(args: EnqueueEntityPatchArgs): Promise<void> {
  const db = getLocalDb();
  const table = writableSyncEntityTable(args.entityClass);
  await db.transaction('rw', [db.outbox, table], async () => {
    const current = await table.get(args.entityId);
    if (!current) throw new Error(`${args.humanName ?? 'This entry'} no longer exists`);
    const ckey = coalesceKey(args.entityId, undefined);
    const dupes = (await db.outbox.where('coalesceKey').equals(ckey).toArray()).filter(
      (op) => op.command === 'patch' && op.fieldPath === undefined,
    );
    const { carriedPrev, predecessorClientOpId } = await coalesceSameKeyOps(dupes);
    const now = new Date().toISOString();
    await table.put({ ...current, ...args.attemptedValue, updatedAt: now });
    await db.outbox.add({
      clientOpId: newClientId(),
      entityClass: args.entityClass,
      entityId: args.entityId,
      command: 'patch',
      coalesceKey: ckey,
      attemptedValue: args.attemptedValue,
      prevValue: args.prevValue ?? (carriedPrev ? carriedPrev.value : current),
      baseRevision: args.baseRevision ?? (current.revision === -1 ? undefined : current.revision),
      parentId: args.campaignId,
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: now,
      attemptCount: 0,
      humanName: args.humanName,
      batchId: args.batchId,
      predecessorClientOpId,
    });
  });
}

/**
 * Resolve the canonical parent id for an outbox row: the character for
 * character children, the campaign for library classes (S6).  For
 * combat the entityId IS the characterId (1:1 keyed), so we fall back
 * to it when the caller didn't pass `characterId` explicitly.  For
 * character / campaign rows the parent concept doesn't apply.
 */
function parentIdFor(
  entityClass: EntityClass,
  characterId: string | undefined,
  entityId: string,
  campaignId?: string,
): string | undefined {
  if (entityClass === 'character' || entityClass === 'campaign') return undefined;
  if (isLibraryEntityClass(entityClass)) {
    if (!campaignId) throw new Error(`${entityClass} operations need their campaign id`);
    return campaignId;
  }
  if (characterId) return characterId;
  if (entityClass === 'character_combat') return entityId;
  return undefined;
}

async function readFieldValue(args: EnqueueFieldPatchArgs): Promise<unknown> {
  const db = getLocalDb();
  const get = async (): Promise<unknown> => {
    switch (args.entityClass) {
      case 'character': {
        const row = await db.characters.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_trait': {
        const row = await db.characterTraits.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_skill': {
        const row = await db.characterSkills.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_spell': {
        const row = await db.characterSpells.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_language': {
        const row = await db.characterLanguages.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_technique': {
        const row = await db.characterTechniques.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_inventory': {
        const row = await db.characterInventory.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      case 'character_combat': {
        const row = await db.characterCombat.get(args.entityId);
        return row ? (row as unknown as Record<string, unknown>)[args.fieldPath] : undefined;
      }
      default:
        return undefined;
    }
  };
  return await get();
}

async function readEntityRevision(args: EnqueueFieldPatchArgs): Promise<number | undefined> {
  const db = getLocalDb();
  let rev: number | undefined;
  switch (args.entityClass) {
    case 'character':
      rev = (await db.characters.get(args.entityId))?.revision;
      break;
    case 'character_trait':
      rev = (await db.characterTraits.get(args.entityId))?.revision;
      break;
    case 'character_skill':
      rev = (await db.characterSkills.get(args.entityId))?.revision;
      break;
    case 'character_spell':
      rev = (await db.characterSpells.get(args.entityId))?.revision;
      break;
    case 'character_language':
      rev = (await db.characterLanguages.get(args.entityId))?.revision;
      break;
    case 'character_technique':
      rev = (await db.characterTechniques.get(args.entityId))?.revision;
      break;
    case 'character_inventory':
      rev = (await db.characterInventory.get(args.entityId))?.revision;
      break;
    case 'character_combat':
      rev = (await db.characterCombat.get(args.entityId))?.revision;
      break;
    default:
      return undefined;
  }
  return rev === -1 ? undefined : rev;
}

export interface EnqueueCreateArgs<T> {
  readonly entityClass: EntityClass;
  /** Client-generated id (uuidv7).  Carried into the server as the canonical id. */
  readonly entityId: string;
  /** Full entity payload to insert into the local store and POST to /sync. */
  readonly attemptedValue: T;
  /** Local-only selected declarations; never included in the operation envelope. */
  readonly localLibraryMechanics?: LibraryMechanics | null | undefined;
  readonly humanName?: string | undefined;
  readonly characterId?: string | undefined;
  /** Owning campaign for library classes (the envelope's `parentId`). */
  readonly campaignId?: string | undefined;
  readonly batchId?: string | undefined;
}

export async function enqueueCreate<T extends Record<string, unknown>>(
  args: EnqueueCreateArgs<T>,
): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const op: OutboxEntry = {
    clientOpId: newClientId(),
    entityClass: args.entityClass,
    entityId: args.entityId,
    command: 'create',
    coalesceKey: `${coalesceKey(args.entityId, undefined)}:create`,
    // For creates we also include `characterId` on the body so the
    // server can read the parent off `attemptedValue` (the legacy
    // path); the new top-level `parentId` is the canonical lookup
    // but we keep both for forward compatibility with older servers.
    attemptedValue: args.characterId
      ? { ...args.attemptedValue, characterId: args.characterId }
      : args.attemptedValue,
    parentId: parentIdFor(args.entityClass, args.characterId, args.entityId, args.campaignId),
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: now,
    attemptCount: 0,
    humanName: args.humanName,
    batchId: args.batchId,
  };
  await db.transaction('rw', [db.outbox, ...storesForOp(args.entityClass)], async () => {
    if (op.parentId && !isLibraryEntityClass(args.entityClass)) {
      op.localWaitForCampaignAssignment = Boolean(
        await db.outbox
          .where('entityId')
          .equals(op.parentId)
          .filter(
            (entry) =>
              entry.entityClass === 'character' &&
              entry.command === 'patch' &&
              entry.fieldPath === 'campaignId' &&
              ['pending', 'in_flight', 'transient_retry'].includes(entry.status),
          )
          .first(),
      );
    }
    await applyLocalCreate(args);
    await db.outbox.add(op);
  });
}

export interface EnqueueDeleteArgs {
  readonly entityClass: EntityClass;
  readonly entityId: string;
  readonly humanName?: string | undefined;
  readonly characterId?: string | undefined;
  /** Owning campaign for library classes (the envelope's `parentId`). */
  readonly campaignId?: string | undefined;
  readonly prevValue?: unknown;
  readonly batchId?: string | undefined;
}

export async function enqueueDelete(args: EnqueueDeleteArgs): Promise<void> {
  const db = getLocalDb();
  await db.transaction('rw', [db.outbox, ...storesForOp(args.entityClass)], async () => {
    await enqueueDeleteInTransaction(args);
  });
}

/** Delete one gesture's entities atomically and retain one history batch id. */
export async function enqueueDeletes(args: readonly EnqueueDeleteArgs[]): Promise<void> {
  if (args.length === 0) return;
  const db = getLocalDb();
  const batchId = args.length > 1 ? newBatchId() : undefined;
  const stores = args.flatMap((entry) => storesForOp(entry.entityClass).map((store) => store.name));
  await db.transaction('rw', [db.outbox, ...stores], async () => {
    for (const entry of args)
      await enqueueDeleteInTransaction({ ...entry, batchId: entry.batchId ?? batchId });
  });
}

async function enqueueDeleteInTransaction(args: EnqueueDeleteArgs): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const prevValue =
    args.prevValue === undefined
      ? await readLocalEntity(args.entityClass, args.entityId)
      : args.prevValue;
  const op: OutboxEntry = {
    clientOpId: newClientId(),
    entityClass: args.entityClass,
    entityId: args.entityId,
    command: 'delete',
    coalesceKey: `${coalesceKey(args.entityId, undefined)}:delete`,
    attemptedValue: args.characterId ? { characterId: args.characterId } : null,
    prevValue,
    parentId: parentIdFor(args.entityClass, args.characterId, args.entityId, args.campaignId),
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: now,
    attemptCount: 0,
    humanName: args.humanName,
    batchId: args.batchId,
  };
  await applyLocalDelete(args.entityClass, args.entityId);
  await db.outbox.add(op);
}

async function readLocalEntity(entityClass: EntityClass, entityId: string): Promise<unknown> {
  return readSyncEntity(entityClass, entityId);
}

/**
 * Run multiple enqueue* calls under a single shared batchId.  Every op
 * enqueued within `fn` that passes the returned `batchId` will share the
 * same group id so the history UI can fold them into one expandable entry.
 *
 * Usage:
 *   const batchId = newBatchId();
 *   await enqueueFieldPatch({ ..., batchId });
 *   await enqueueFieldPatch({ ..., batchId });
 */
export function newBatchId(): string {
  return newClientId();
}

// ---------- internal: local writers ----------

function storesForOp(entityClass: EntityClass) {
  const table = syncEntityTable(entityClass);
  if (!table) return [];
  return entityClass === 'character' ? [table, ...campaignTransferStores()] : [table];
}

async function applyLocalPatch(args: EnqueueFieldPatchArgs): Promise<void> {
  await updateSyncEntity(args.entityClass, args.entityId, {
    [args.fieldPath]: args.attemptedValue,
    updatedAt: new Date().toISOString(),
  });
}

async function applyLocalCreate<T extends Record<string, unknown>>(
  args: EnqueueCreateArgs<T>,
): Promise<void> {
  const now = new Date().toISOString();
  const base = {
    id: args.entityId,
    createdAt: now,
    updatedAt: now,
    /**
     * Sentinel revision for locally-created rows that haven't sync'd
     * yet.  -1 lets the cursor pull "if revision <= 0 don't overwrite
     * with server-side data unless the server confirms ownership of
     * this id".  Once /sync/operations returns `applied` with a real
     * revision, the orchestrator overwrites this.
     */
    revision: -1,
    ...args.attemptedValue,
    // Library rows are looked up by campaign; the id travels as parentId,
    // never inside the (strict) create body.
    ...(isLibraryEntityClass(args.entityClass) && args.campaignId
      ? { campaignId: args.campaignId }
      : {}),
  } as Record<string, unknown>;
  if (args.entityClass === 'character_trait' || args.entityClass === 'character_skill') {
    const snapshot =
      args.localLibraryMechanics == null
        ? null
        : libraryMechanics.parse(args.localLibraryMechanics);
    const field = args.entityClass === 'character_trait' ? 'libraryTraitId' : 'librarySkillId';
    if (snapshot && (snapshot.sourceId !== base[field] || snapshot.detached))
      throw new Error('Selected library rules do not match the new copy');
    base.libraryMechanics = snapshot;
  }
  const table = writableSyncEntityTable(args.entityClass);
  await table.put(
    args.entityClass === 'character_combat'
      ? ({ ...base, characterId: args.entityId } as unknown as {
          id: string;
          revision: number;
          [key: string]: unknown;
        })
      : (base as unknown as { id: string; revision: number; [key: string]: unknown }),
  );
}

async function applyLocalDelete(entityClass: EntityClass, entityId: string): Promise<void> {
  await deleteSyncEntity(entityClass, entityId);
}

// ---------- queries used by the orchestrator ----------

/**
 * Ops eligible to drain right now.
 *
 * Includes BOTH `pending` (never tried) AND `transient_retry`
 * (previous attempt failed transiently, waiting for backoff to elapse)
 * rows.  Without the second status, an op that hits a single network
 * blip would get stuck in `transient_retry` forever -- the orchestrator
 * never re-promotes them to `pending`, so a status filter that only
 * matches `pending` would silently drop them.
 *
 * Rows with a future `nextEarliestAttemptAt` are held back so the
 * backoff window is honored.  Crucially, holding back a `create` also
 * holds back every later op that depends on it: patches/deletes on the
 * same entity and any op whose `parentId` is the held-back entity.
 * Without that gate, a child patch could drain while its parent create
 * was still backing off -- the server answers `unauthorized: not found`
 * and the orchestrator rolls the user's queued edit back (data loss)
 * even though the create would have succeeded seconds later.
 *
 * Campaign assignments wait for older creates and gate destination creates until
 * acknowledged: even a parent
 * patch included earlier in the same batch can fail transiently, so its children
 * must wait for a later drain. Ordinary independent field patches stay parallel.
 */
export async function resolveLegacyCampaignDependency(
  clientOpId: string,
  wait: boolean,
): Promise<void> {
  const db = getLocalDb();
  await db.transaction('rw', [db.outbox, db.characters], async () => {
    const op = await db.outbox.get(clientOpId);
    if (!op?.localCampaignDependencyUnknown) return;
    const assignments = (
      await db.outbox
        .where('entityId')
        .equals(op.parentId ?? '')
        .toArray()
    )
      .filter(
        (entry) =>
          entry.entityClass === 'character' &&
          entry.command === 'patch' &&
          entry.fieldPath === 'campaignId' &&
          ['pending', 'in_flight', 'transient_retry'].includes(entry.status),
      )
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
    const current = (await db.characters.get(op.parentId ?? ''))?.campaignId;
    const chosen =
      assignments.length > 0
        ? wait
          ? assignments.at(-1)?.attemptedValue
          : assignments[0]?.prevValue
        : current;
    if (op.localRequiredCampaignId !== undefined && chosen !== op.localRequiredCampaignId)
      throw new Error(
        'Move the character to the library addition’s campaign before confirming its order.',
      );
    await db.outbox.update(clientOpId, {
      localWaitForCampaignAssignment: wait,
      localCampaignDependencyUnknown: false,
      ...(typeof chosen === 'string' || chosen === null ? { localRequiredCampaignId: chosen } : {}),
    });
  });
}

export async function readDrainableOps(limit: number, nowMs = Date.now()): Promise<OutboxEntry[]> {
  const db = getLocalDb();
  const now = new Date(nowMs).toISOString();
  const unsettled = await db.outbox
    .where('status')
    .anyOf(['pending', 'transient_retry', 'in_flight'])
    .toArray();
  const assignmentOps = unsettled
    .filter(
      (op) =>
        op.entityClass === 'character' && op.command === 'patch' && op.fieldPath === 'campaignId',
    )
    .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  const assignmentsFor = (parentId: string | undefined) =>
    assignmentOps.filter((op) => op.entityId === parentId);
  const campaignCreateReady = new Set<string>();
  for (const op of unsettled) {
    if (op.command !== 'create' || op.localRequiredCampaignId === undefined) continue;
    const moves = assignmentsFor(op.parentId);
    const current =
      moves.length > 0
        ? moves[0]?.prevValue
        : (await db.characters.get(op.parentId ?? ''))?.campaignId;
    if (
      current === op.localRequiredCampaignId &&
      !moves.some((move) => move.status === 'in_flight')
    )
      campaignCreateReady.add(op.clientOpId);
    else if (
      current !== op.localRequiredCampaignId &&
      !moves.some((move) => move.attemptedValue === op.localRequiredCampaignId)
    ) {
      // A rejected/coalesced prerequisite must not release a linked create
      // against the wrong campaign or strand it without recovery guidance.
      op.localCampaignDependencyUnknown = true;
      await db.outbox.update(op.clientOpId, { localCampaignDependencyUnknown: true });
    }
  }
  const all = unsettled.filter((op) => op.status !== 'in_flight');
  const campaignAssignments = new Set(
    unsettled
      .filter(
        (op) =>
          op.entityClass === 'character' && op.command === 'patch' && op.fieldPath === 'campaignId',
      )
      .map((op) => op.entityId),
  );
  const parentsWithEarlierCreates = new Set(
    unsettled
      .filter(
        (op) =>
          op.command === 'create' &&
          (op.localCampaignDependencyUnknown ||
            (op.localRequiredCampaignId === undefined && !op.localWaitForCampaignAssignment)) &&
          op.parentId !== undefined,
      )
      .map((op) => op.parentId),
  );
  // Deterministic replay order: enqueue time, then create < patch <
  // delete so a create+patch enqueued in the same millisecond can never
  // invert (the server applies the batch in array order).
  const commandRank: Record<OperationCommand, number> = { create: 0, patch: 1, delete: 2 };
  all.sort((a, b) => {
    if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
    if (a.command !== b.command) return commandRank[a.command] - commandRank[b.command];
    return a.clientOpId < b.clientOpId ? -1 : 1;
  });
  const heldBackCreates = new Set<string>();
  const unsettledCreates = new Set(
    unsettled
      .filter((candidate) => candidate.command === 'create')
      .map((candidate) => candidate.entityId),
  );
  const unsettledClientOpIds = new Set(unsettled.map((candidate) => candidate.clientOpId));
  const ready: OutboxEntry[] = [];
  for (const op of all) {
    const backingOff = op.nextEarliestAttemptAt !== undefined && op.nextEarliestAttemptAt > now;
    // Inventory containment is carried in the create body / parentId field,
    // not in the envelope's parentId (that is the character id). Do not send
    // a child or reparent operation until a speculative container create has
    // been acknowledged and removed from the outbox. Using a later drain also
    // prevents a transient parent outcome from turning its dependent into a
    // permanent server rejection in the same request.
    const inventoryContainerId =
      op.entityClass === 'character_inventory' &&
      ((op.command === 'create' &&
        op.attemptedValue &&
        typeof op.attemptedValue === 'object' &&
        typeof (op.attemptedValue as { parentId?: unknown }).parentId === 'string') ||
        (op.command === 'patch' &&
          op.fieldPath === 'parentId' &&
          typeof op.attemptedValue === 'string'))
        ? op.command === 'create'
          ? (op.attemptedValue as { parentId: string }).parentId
          : (op.attemptedValue as string)
        : undefined;
    const dependencyHeld =
      (op.predecessorClientOpId !== undefined &&
        unsettledClientOpIds.has(op.predecessorClientOpId)) ||
      op.localCampaignDependencyUnknown === true ||
      (op.entityClass === 'character' &&
        op.fieldPath === 'campaignId' &&
        (parentsWithEarlierCreates.has(op.entityId) ||
          unsettled.some(
            (child) =>
              child.command === 'create' &&
              child.parentId === op.entityId &&
              child.localRequiredCampaignId !== undefined &&
              child.localRequiredCampaignId === op.prevValue,
          ))) ||
      heldBackCreates.has(op.entityId) ||
      (op.parentId !== undefined && heldBackCreates.has(op.parentId)) ||
      (op.command === 'create' &&
        op.localRequiredCampaignId !== undefined &&
        !campaignCreateReady.has(op.clientOpId)) ||
      (op.command === 'create' &&
        op.localRequiredCampaignId === undefined &&
        op.localWaitForCampaignAssignment === true &&
        op.parentId !== undefined &&
        campaignAssignments.has(op.parentId)) ||
      (inventoryContainerId !== undefined && unsettledCreates.has(inventoryContainerId));
    if (!backingOff && !dependencyHeld && ready.length < limit) {
      ready.push(op);
    } else if (op.command === 'create') {
      // Anything created under (or on) this entity must wait its turn.
      heldBackCreates.add(op.entityId);
    }
  }
  return ready;
}

/** Milliseconds until the next explicitly delayed pending/retry row becomes eligible. */
export async function nextOutboxAttemptDelay(nowMs = Date.now()): Promise<number | undefined> {
  const rows = await getLocalDb()
    .outbox.where('status')
    .anyOf(['pending', 'transient_retry'])
    .toArray();
  let earliest: number | undefined;
  for (const row of rows) {
    if (!row.nextEarliestAttemptAt) continue;
    const at = Date.parse(row.nextEarliestAttemptAt);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    earliest = earliest === undefined ? at : Math.min(earliest, at);
  }
  return earliest === undefined ? undefined : Math.max(1, earliest - nowMs);
}

/**
 * Repair ids emitted by the pre-#132 Math.random fallback. That fallback
 * repeated a short random fragment and could produce UUID groups shorter
 * than the wire schema permits. Re-key before selection so an already-stuck
 * operation retries immediately after a client upgrade instead of requiring
 * the player to make another edit.
 */
async function repairBrokenFallbackIdsInTransaction(): Promise<void> {
  const db = getLocalDb();
  const entries = await db.outbox
    .where('status')
    .anyOf(['pending', 'transient_retry', 'in_flight'])
    .toArray();
  const usedClientIds = new Set(entries.map((entry) => entry.clientOpId));
  const repairedBatchIds = new Map<string, string>();
  const repairedClientIds = new Map<string, string>();

  const freshClientId = () => {
    let id = newClientId();
    while (usedClientIds.has(id)) id = newClientId();
    usedClientIds.add(id);
    return id;
  };

  for (const entry of entries) {
    if (wasGeneratedByBrokenUuidFallback(entry.clientOpId)) {
      repairedClientIds.set(entry.clientOpId, freshClientId());
    }
  }

  for (const entry of entries) {
    const nextClientOpId = repairedClientIds.get(entry.clientOpId) ?? entry.clientOpId;
    const repairClientId = nextClientOpId !== entry.clientOpId;
    const repairBatchId = wasGeneratedByBrokenUuidFallback(entry.batchId);
    const nextPredecessorClientOpId = entry.predecessorClientOpId
      ? (repairedClientIds.get(entry.predecessorClientOpId) ?? entry.predecessorClientOpId)
      : undefined;
    const repairPredecessor = nextPredecessorClientOpId !== entry.predecessorClientOpId;
    if (!repairClientId && !repairBatchId && !repairPredecessor) continue;

    let nextBatchId = entry.batchId;
    if (repairBatchId && entry.batchId) {
      nextBatchId = repairedBatchIds.get(entry.batchId);
      if (!nextBatchId) {
        nextBatchId = freshClientId();
        repairedBatchIds.set(entry.batchId, nextBatchId);
      }
    }
    const repaired: OutboxEntry = {
      ...entry,
      clientOpId: nextClientOpId,
      batchId: nextBatchId,
      predecessorClientOpId: nextPredecessorClientOpId,
      deliveryUncertain: undefined,
      status: 'pending',
      attemptCount: 0,
      lastAttemptAt: undefined,
      nextEarliestAttemptAt: undefined,
      serverReason: undefined,
      lastError: undefined,
    };

    if (repairClientId) {
      await db.outbox.delete(entry.clientOpId);
      await db.outbox.add(repaired);
    } else {
      await db.outbox.put(repaired);
    }
  }
}

/**
 * Upgrade outboxes written before delivery uncertainty and predecessor links
 * were persisted. A legacy retry may have reached the server, so treating an
 * absent flag as safe would let a newer same-field patch overtake it.
 */
async function normalizeLegacyDeliveryChainsInTransaction(): Promise<void> {
  const db = getLocalDb();
  const rows = (await db.outbox.toArray()).filter(
    (entry) => entry.command === 'patch' && entry.fieldPath !== undefined,
  );
  const groups = new Map<string, OutboxEntry[]>();
  for (const row of rows) {
    const group = groups.get(row.coalesceKey) ?? [];
    group.push(row);
    groups.set(row.coalesceKey, group);
  }
  for (const group of groups.values()) {
    for (const row of group) {
      if (row.status === 'transient_retry' && row.deliveryUncertain === undefined) {
        row.deliveryUncertain = true;
        await db.outbox.update(row.clientOpId, { deliveryUncertain: true });
      }
    }
    group.sort((a, b) => {
      const blockerRank = (entry: OutboxEntry) =>
        entry.status === 'in_flight' ||
        (entry.status === 'transient_retry' && entry.deliveryUncertain)
          ? 0
          : 1;
      const byRank = blockerRank(a) - blockerRank(b);
      if (byRank !== 0) return byRank;
      const byTime = a.enqueuedAt.localeCompare(b.enqueuedAt);
      return byTime !== 0 ? byTime : a.clientOpId.localeCompare(b.clientOpId);
    });
    let predecessor: string | undefined;
    for (const row of group) {
      if (predecessor && !row.predecessorClientOpId) {
        row.predecessorClientOpId = predecessor;
        await db.outbox.update(row.clientOpId, { predecessorClientOpId: predecessor });
      }
      if (
        row.status === 'in_flight' ||
        (row.status === 'transient_retry' && row.deliveryUncertain)
      ) {
        predecessor = row.clientOpId;
      }
    }
  }
}

/**
 * Select and claim one outbound batch atomically. Enqueue coalescing sees
 * every selected row as `in_flight`; a replacement therefore queues behind
 * it instead of deleting an op whose stale in-memory envelope will be sent.
 * Network I/O remains outside this short transaction.
 */
export async function claimDrainableOps(limit: number, nowMs = Date.now()): Promise<OutboxEntry[]> {
  const db = getLocalDb();
  return db.transaction('rw', [db.outbox, db.characters], async () => {
    await repairBrokenFallbackIdsInTransaction();
    await normalizeLegacyDeliveryChainsInTransaction();
    const selected = await readDrainableOps(limit, nowMs);
    const claimedAt = new Date().toISOString();
    const claimed: OutboxEntry[] = [];
    for (const op of selected) {
      const current = await db.outbox.get(op.clientOpId);
      if (!current || (current.status !== 'pending' && current.status !== 'transient_retry'))
        continue;
      await db.outbox.update(op.clientOpId, {
        status: 'in_flight',
        lastAttemptAt: claimedAt,
        attemptCount: current.attemptCount + 1,
      });
      // Keep the pre-claim attemptCount: outcome/backoff code computes the
      // completed attempt as op.attemptCount + 1.
      // Outcome handling needs the pre-claim status to distinguish the first
      // transition into retry from later attempts in the same failure streak.
      // The durable row is still `in_flight`; only this send-time snapshot
      // retains the status that was atomically claimed.
      claimed.push({ ...current, lastAttemptAt: claimedAt });
    }
    return claimed;
  });
}

/**
 * Recover stale `in_flight` rows as delivery-uncertain retries.
 *
 * MUST be called while holding the cross-tab drain lock: under the
 * lock, no tab can have a /sync/operations POST outstanding, so any
 * row still marked `in_flight` was orphaned by a crash, tab close, or
 * an error between marking and settling.  Without this sweep those
 * rows are invisible to `readDrainableOps` forever -- the edit never
 * syncs and `countPending` pins the indicator at 'syncing'.
 *
 * A newer same-field patch is held behind this retry so client replay order
 * cannot put an older value after the newer one. Creates are replay-safe by
 * stable entity id, and deletes of already-deleted rows are no-ops.
 */
export async function recoverStaleInFlight(): Promise<number> {
  const db = getLocalDb();
  const stale = await db.outbox.where('status').equals('in_flight').primaryKeys();
  for (const clientOpId of stale) {
    await db.outbox.update(clientOpId, {
      status: 'transient_retry',
      deliveryUncertain: true,
      serverReason: 'recovered from interrupted send',
    });
  }
  return stale.length;
}

export async function countPending(): Promise<number> {
  const db = getLocalDb();
  return await db.outbox.where('status').anyOf(['pending', 'transient_retry', 'in_flight']).count();
}

export async function setOutboxStatus(
  clientOpId: string,
  status: OutboxStatus,
  patch: Partial<OutboxEntry> = {},
): Promise<void> {
  await getLocalDb().outbox.update(clientOpId, { status, ...patch });
}

/**
 * Compute the next-attempt timestamp for a `transient` outcome.
 * Exponential backoff with jitter, capped at 60s while the op is
 * "fresh" and relaxing to a 5-minute cap once it has burned through
 * MAX_ATTEMPTS.  Transient failures never give up entirely -- a
 * durable outbox that silently stops retrying would leave the local
 * row diverged from the server forever with no path back; a slow
 * retry cadence self-heals the moment the server recovers.  Pure so
 * the orchestrator tests can stub time.
 */
export function backoffMs(attemptCount: number): number {
  const cap = attemptCount > MAX_ATTEMPTS ? 300_000 : 60_000;
  const base = Math.min(cap, 2 ** attemptCount * 500);
  const jitter = Math.random() * Math.min(1000, base * 0.25);
  return base + jitter;
}

export const MAX_ATTEMPTS = 8;
