/**
 * Outbox: the durable queue of pending mutations.
 *
 * `enqueueOp` writes the local entity row AND the outbox entry inside
 * one Dexie transaction so a mutation is either fully durable
 * (visible in `useLiveQuery` AND queued for replay) or not at all.
 *
 * Coalescing (AGENTS.md rule 1): when a `pending` patch op already
 * exists for the same `(entityId, fieldPath)` we delete it and insert
 * the latest value -- "additional commits to X queue (latest value
 * wins)".  `create` and `delete` are never coalesced.
 */

import type { EntityClass, OperationCommand } from '../../shared/schemas/sync.ts';
import {
  type LocalCharacter,
  type LocalCharacterCombat,
  type LocalCharacterInventory,
  type LocalCharacterSkill,
  type LocalCharacterSpell,
  type LocalCharacterTrait,
  type OutboxEntry,
  type OutboxStatus,
  coalesceKey,
  getLocalDb,
} from '../db/dexie.ts';

/**
 * Generate a uuidv7-shaped string client-side.  We don't need
 * cryptographic monotonicity; a `crypto.randomUUID()` v4 is sufficient
 * for client identity and the server accepts any uuid in the create
 * dispatcher.
 */
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for very old environments.  Not cryptographically random;
  // good enough for non-sensitive identity.
  const r = Math.random().toString(16).slice(2).padEnd(12, '0');
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-4${r.slice(12, 15)}-8${r.slice(15, 18)}-${r.slice(0, 12)}`;
}

export interface EnqueueFieldPatchArgs {
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
}

/**
 * Patch one field on one entity.  Coalesces against any pending patch
 * for the same (entityId, fieldPath).
 */
export async function enqueueFieldPatch(args: EnqueueFieldPatchArgs): Promise<void> {
  const db = getLocalDb();
  const ckey = coalesceKey(args.entityId, args.fieldPath);
  const now = new Date().toISOString();
  await db.transaction('rw', [db.outbox, ...storesForOp(args.entityClass)], async () => {
    // 1. Capture the current local value as prevValue so a later
    //    server rejection can revert without the caller tracking it.
    //    Done inside the transaction so a concurrent local write
    //    can't sneak between the read and the patch.
    const prev = args.prevValue ?? (await readFieldValue(args));
    const baseRev = args.baseRevision ?? (await readEntityRevision(args));

    // 2. Coalesce any pending patch for the same field (latest wins).
    //    We only replace `pending`/`transient_retry` rows; in_flight
    //    rows are mid-send and will settle before our orchestrator
    //    drains the new one.  rejected/applied rows are keepsakes
    //    (audit + persistent toast) and shouldn't be touched.
    const dupes = await db.outbox.where('coalesceKey').equals(ckey).toArray();
    for (const d of dupes) {
      if (d.status === 'pending' || d.status === 'transient_retry') {
        await db.outbox.delete(d.clientOpId);
      }
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
    };
    await db.outbox.add(op);
  });
}

/**
 * Resolve the canonical parent character id for an outbox row.  For
 * combat the entityId IS the characterId (1:1 keyed), so we fall back
 * to it when the caller didn't pass `characterId` explicitly.  For
 * character / campaign rows the parent concept doesn't apply.
 */
function parentIdFor(
  entityClass: EntityClass,
  characterId: string | undefined,
  entityId: string,
): string | undefined {
  if (entityClass === 'character' || entityClass === 'campaign') return undefined;
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
  switch (args.entityClass) {
    case 'character':
      return (await db.characters.get(args.entityId))?.revision;
    case 'character_trait':
      return (await db.characterTraits.get(args.entityId))?.revision;
    case 'character_skill':
      return (await db.characterSkills.get(args.entityId))?.revision;
    case 'character_spell':
      return (await db.characterSpells.get(args.entityId))?.revision;
    case 'character_inventory':
      return (await db.characterInventory.get(args.entityId))?.revision;
    case 'character_combat':
      return (await db.characterCombat.get(args.entityId))?.revision;
    default:
      return undefined;
  }
}

export interface EnqueueCreateArgs<T> {
  readonly entityClass: EntityClass;
  /** Client-generated id (uuidv7).  Carried into the server as the canonical id. */
  readonly entityId: string;
  /** Full entity payload to insert into the local store and POST to /sync. */
  readonly attemptedValue: T;
  readonly humanName?: string | undefined;
  readonly characterId?: string | undefined;
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
    parentId: parentIdFor(args.entityClass, args.characterId, args.entityId),
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: now,
    attemptCount: 0,
    humanName: args.humanName,
    batchId: args.batchId,
  };
  await db.transaction('rw', [db.outbox, ...storesForOp(args.entityClass)], async () => {
    await applyLocalCreate(args);
    await db.outbox.add(op);
  });
}

export interface EnqueueDeleteArgs {
  readonly entityClass: EntityClass;
  readonly entityId: string;
  readonly humanName?: string | undefined;
  readonly characterId?: string | undefined;
  readonly prevValue?: unknown;
  readonly batchId?: string | undefined;
}

export async function enqueueDelete(args: EnqueueDeleteArgs): Promise<void> {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const op: OutboxEntry = {
    clientOpId: newClientId(),
    entityClass: args.entityClass,
    entityId: args.entityId,
    command: 'delete',
    coalesceKey: `${coalesceKey(args.entityId, undefined)}:delete`,
    attemptedValue: args.characterId ? { characterId: args.characterId } : null,
    prevValue: args.prevValue,
    parentId: parentIdFor(args.entityClass, args.characterId, args.entityId),
    validationVersion: 1,
    status: 'pending',
    enqueuedAt: now,
    attemptCount: 0,
    humanName: args.humanName,
    batchId: args.batchId,
  };
  await db.transaction('rw', [db.outbox, ...storesForOp(args.entityClass)], async () => {
    await applyLocalDelete(args.entityClass, args.entityId);
    await db.outbox.add(op);
  });
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
  const db = getLocalDb();
  switch (entityClass) {
    case 'character':
      return [db.characters];
    case 'character_trait':
      return [db.characterTraits];
    case 'character_skill':
      return [db.characterSkills];
    case 'character_spell':
      return [db.characterSpells];
    case 'character_inventory':
      return [db.characterInventory];
    case 'character_combat':
      return [db.characterCombat];
    case 'campaign':
      return [db.campaigns];
    default:
      return [];
  }
}

async function applyLocalPatch(args: EnqueueFieldPatchArgs): Promise<void> {
  const db = getLocalDb();
  const updates: Record<string, unknown> = {
    [args.fieldPath]: args.attemptedValue,
    updatedAt: new Date().toISOString(),
  };
  switch (args.entityClass) {
    case 'character':
      await db.characters.update(args.entityId, updates as Partial<LocalCharacter>);
      return;
    case 'character_trait':
      await db.characterTraits.update(args.entityId, updates as Partial<LocalCharacterTrait>);
      return;
    case 'character_skill':
      await db.characterSkills.update(args.entityId, updates as Partial<LocalCharacterSkill>);
      return;
    case 'character_spell':
      await db.characterSpells.update(args.entityId, updates as Partial<LocalCharacterSpell>);
      return;
    case 'character_inventory':
      await db.characterInventory.update(
        args.entityId,
        updates as Partial<LocalCharacterInventory>,
      );
      return;
    case 'character_combat':
      // combat is keyed by characterId; entityId IS the characterId.
      await db.characterCombat.update(args.entityId, updates as Partial<LocalCharacterCombat>);
      return;
    default:
      // Other entity classes don't have a local writer yet.
      return;
  }
}

async function applyLocalCreate<T extends Record<string, unknown>>(
  args: EnqueueCreateArgs<T>,
): Promise<void> {
  const db = getLocalDb();
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
  } as Record<string, unknown>;
  switch (args.entityClass) {
    case 'character':
      await db.characters.put(base as unknown as LocalCharacter);
      return;
    case 'character_trait':
      await db.characterTraits.put(base as unknown as LocalCharacterTrait);
      return;
    case 'character_skill':
      await db.characterSkills.put(base as unknown as LocalCharacterSkill);
      return;
    case 'character_spell':
      await db.characterSpells.put(base as unknown as LocalCharacterSpell);
      return;
    case 'character_inventory':
      await db.characterInventory.put(base as unknown as LocalCharacterInventory);
      return;
    case 'character_combat':
      await db.characterCombat.put({
        ...base,
        characterId: args.entityId,
      } as unknown as LocalCharacterCombat);
      return;
    default:
      return;
  }
}

async function applyLocalDelete(entityClass: EntityClass, entityId: string): Promise<void> {
  const db = getLocalDb();
  switch (entityClass) {
    case 'character':
      await db.characters.delete(entityId);
      return;
    case 'character_trait':
      await db.characterTraits.delete(entityId);
      return;
    case 'character_skill':
      await db.characterSkills.delete(entityId);
      return;
    case 'character_spell':
      await db.characterSpells.delete(entityId);
      return;
    case 'character_inventory':
      await db.characterInventory.delete(entityId);
      return;
    case 'character_combat':
      await db.characterCombat.delete(entityId);
      return;
    default:
      return;
  }
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
 * Rows with a future `nextEarliestAttemptAt` are filtered out post-query
 * so the backoff window is honored.
 */
export async function readDrainableOps(limit: number): Promise<OutboxEntry[]> {
  const db = getLocalDb();
  const now = new Date().toISOString();
  const all = await db.outbox
    .where('status')
    .anyOf(['pending', 'transient_retry'])
    .sortBy('enqueuedAt');
  const ready = all.filter((op) => !op.nextEarliestAttemptAt || op.nextEarliestAttemptAt <= now);
  return ready.slice(0, limit);
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
 * Exponential backoff with jitter, capped at 60s.  Pure so the
 * orchestrator tests can stub time.
 */
export function backoffMs(attemptCount: number): number {
  const base = Math.min(60_000, 2 ** attemptCount * 500);
  const jitter = Math.random() * Math.min(1000, base * 0.25);
  return base + jitter;
}

export const MAX_ATTEMPTS = 8;
