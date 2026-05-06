/**
 * Sync orchestrator -- the long-lived singleton that:
 *   - drains the Dexie outbox into POST /sync/operations,
 *   - pulls upsert/tombstone changes via POST /sync/cursor,
 *   - bootstraps Dexie on first login (full snapshot before UI shows),
 *   - emits sync state to the indicator (`SyncStateStore`) and async
 *     rollback events to inputs (`flashBus`),
 *   - handles online/offline detection, exponential backoff, and
 *     multi-tab safety via `navigator.locks`.
 *
 * Mutation handlers in the UI never touch the network -- they only
 * call `enqueueFieldPatch` / `enqueueCreate` / `enqueueDelete` from
 * outbox.ts.  This module is the only thing that talks to /sync/*.
 *
 * Local-first invariant: server cursor data NEVER overwrites a row
 * that has a `pending` or `in_flight` outbox op for the same
 * (entityId, fieldPath).  See `applyServerRow`.
 */

import { liveQuery } from 'dexie';
import type {
  EntityClass,
  OperationEnvelope,
  OperationOutcome,
  SyncCursorChange,
  SyncCursorResponse,
  SyncOperationsResponse,
} from '../../shared/schemas/sync.ts';
import {
  type LocalCharacter,
  type LocalCharacterCombat,
  type LocalCharacterInventory,
  type LocalCharacterSkill,
  type LocalCharacterTrait,
  type OutboxEntry,
  type RejectionRecord,
  coalesceKey,
  getLocalDb,
} from '../db/dexie.ts';
import { api } from '../lib/api.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { flashBus, makeFlashKey } from './flashBus.ts';
import { characterIdsToMinimize } from './minimalViewSweep.ts';
import {
  MAX_ATTEMPTS,
  backoffMs,
  countPending,
  enqueueFieldPatch,
  readDrainableOps,
  setOutboxStatus,
} from './outbox.ts';
import { syncStateStore } from './state.ts';

const ALL_ENTITY_CLASSES: EntityClass[] = [
  'character',
  'character_trait',
  'character_skill',
  'character_inventory',
  'character_combat',
];

const DRAIN_BATCH_SIZE = 50;
const PERIODIC_PULL_MS = 30_000;

interface OrchestratorEvents {
  /** Notified after a drain or pull cycle completes (success or partial failure). */
  cycleDone(): void;
}

class SyncOrchestrator {
  private started = false;
  private running = false;
  private wakeUpResolve: (() => void) | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private outboxLiveSub: { unsubscribe(): void } | null = null;
  private listeners = new Set<keyof OrchestratorEvents>();
  private cycleListeners = new Set<() => void>();
  /**
   * The viewer's user id, captured at bootstrap. Used by
   * `enforceMinimalViewLocally` to figure out which campaign-shared
   * characters the viewer is allowed to see in detail. Null until
   * bootstrap runs (the orchestrator is a singleton; periodic pulls
   * before bootstrap are no-ops anyway).
   */
  private currentUserId: string | null = null;

  /** Idempotent.  Wires online/offline + outbox liveQuery + drain loop. */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }

    // Wake the drain loop whenever a new outbox row is added.  Using
    // `liveQuery` over `countPending` is cheaper than scanning the
    // outbox table on every Dexie change.
    this.outboxLiveSub = liveQuery(() => countPending()).subscribe({
      next: (n) => {
        if (n > 0) this.wake();
        this.refreshIndicator(n);
      },
      error: () => {
        /* swallow -- the loop will recover on the next signal */
      },
    });

    this.periodicTimer = setInterval(() => {
      void this.triggerCursorPull().catch(() => {
        /* logged inside pull */
      });
    }, PERIODIC_PULL_MS);

    void this.runLoop();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.running = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
    this.outboxLiveSub?.unsubscribe();
    this.outboxLiveSub = null;
    this.wake();
  }

  /** Force the drain loop to re-evaluate immediately. */
  triggerDrain(): void {
    this.wake();
  }

  /**
   * Pull /sync/cursor for every known entity class and apply the
   * results into Dexie.  Safe to call repeatedly; each class's cursor
   * is the high-water mark seen so far.
   */
  async triggerCursorPull(): Promise<void> {
    if (!tokenStore.read()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    syncStateStore.set('syncing');
    try {
      let hasMore = true;
      while (hasMore) {
        const cursors = await this.readCursors();
        const res = await api<SyncCursorResponse>('/sync/cursor', {
          method: 'POST',
          body: { cursors, pageSize: 200 },
        });
        await this.applyCursorResponse(res);
        hasMore = Object.values(res.hasMore ?? {}).some((v) => v);
      }
      // After every successful pull, drop any private child rows that
      // were synced earlier but the viewer is no longer allowed to see
      // (campaign was just flipped to shareCharacterSheets=false). The
      // server stops emitting them as upserts; this sweep cleans up
      // what's already in Dexie.
      await this.enforceMinimalViewLocally();
      this.fireCycleDone();
      const pending = await countPending();
      this.refreshIndicator(pending);
    } catch (_err) {
      syncStateStore.set('error');
    }
  }

  /**
   * Initial-snapshot pull on a fresh login.  Same as `triggerCursorPull`
   * except it always starts from cursor 0 and writes a per-user
   * "bootstrapped" flag so the SyncBootstrapGate can render the UI
   * straight away on subsequent loads.
   */
  async bootstrap(userId: string): Promise<void> {
    // Captured for `enforceMinimalViewLocally` — the periodic
    // cursor-pull doesn't otherwise know who's logged in.
    this.currentUserId = userId;
    const db = getLocalDb();
    const flagKey = `bootstrap:${userId}`;
    const flag = await db.syncMeta.get(flagKey);
    if (!flag) {
      // Wipe any per-class cursors carried over from a previous account
      // so we definitely start at 0 and pull every owned row.
      await db.syncCursors.clear();
    }
    await this.triggerCursorPull();
    await db.syncMeta.put({ key: flagKey, value: { bootstrappedAt: new Date().toISOString() } });
    // Re-emit any persistent rejection toasts that survived the
    // reload so the user doesn't lose an open error.
    await this.replayRejectionToasts();
  }

  /** Wipe Dexie and reset state -- called on logout. */
  async purge(): Promise<void> {
    this.currentUserId = null;
    const db = getLocalDb();
    await db.transaction(
      'rw',
      [
        db.characters,
        db.characterTraits,
        db.characterSkills,
        db.characterInventory,
        db.characterCombat,
        db.campaigns,
        db.outbox,
        db.syncCursors,
        db.syncMeta,
        db.tombstones,
        db.rejectionToasts,
      ],
      async () => {
        await db.characters.clear();
        await db.characterTraits.clear();
        await db.characterSkills.clear();
        await db.characterInventory.clear();
        await db.characterCombat.clear();
        await db.campaigns.clear();
        await db.outbox.clear();
        await db.syncCursors.clear();
        await db.syncMeta.clear();
        await db.tombstones.clear();
        await db.rejectionToasts.clear();
      },
    );
    syncStateStore.reset('synced');
  }

  onCycleDone(cb: () => void): () => void {
    this.cycleListeners.add(cb);
    return () => {
      this.cycleListeners.delete(cb);
    };
  }

  // ---------- internals ----------

  private onOnline = (): void => {
    this.wake();
  };

  private onOffline = (): void => {
    // Indicator stays 'syncing' if outbox has work; otherwise idle.
    void countPending().then((n) => this.refreshIndicator(n));
  };

  private wake(): void {
    if (this.wakeUpResolve) {
      this.wakeUpResolve();
      this.wakeUpResolve = null;
    }
  }

  private async waitForSignal(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wakeUpResolve = resolve;
      setTimeout(() => {
        if (this.wakeUpResolve === resolve) {
          this.wakeUpResolve = null;
          resolve();
        }
      }, timeoutMs);
    });
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.running) {
      try {
        await this.maybeDrainOnce();
      } catch (_err) {
        syncStateStore.set('error');
      }
      // Wait for an outbox change, an online event, or 5s, whichever
      // comes first.
      await this.waitForSignal(5_000);
    }
  }

  private async maybeDrainOnce(): Promise<void> {
    if (!tokenStore.read()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Can't drain while offline -- leave the indicator showing
      // 'syncing' if anything is pending so the user knows their
      // edits haven't reached the server yet.
      const pending = await countPending();
      if (pending > 0) syncStateStore.set('syncing');
      return;
    }

    // Acquire an exclusive cross-tab lock so two open tabs don't both
    // POST the same outbox rows.  The other tab still reads from
    // Dexie via useLiveQuery -- we just serialize the outbound flush.
    await runWithLock('sync-drain', async () => {
      const ops = await readDrainableOps(DRAIN_BATCH_SIZE);
      if (ops.length === 0) {
        // Nothing to drain -- but if /sync/cursor hasn't run recently,
        // do that now to keep Dexie fresh.
        await this.triggerCursorPull();
        return;
      }
      syncStateStore.set('syncing');
      // Mark in_flight so other refresh signals don't re-pick them.
      for (const op of ops) {
        await setOutboxStatus(op.clientOpId, 'in_flight', {
          lastAttemptAt: new Date().toISOString(),
          attemptCount: op.attemptCount + 1,
        });
      }
      let outcomes: OperationOutcome[] = [];
      try {
        const res = await api<SyncOperationsResponse>('/sync/operations', {
          method: 'POST',
          body: { operations: ops.map(toEnvelope) },
        });
        outcomes = res.outcomes ?? [];
      } catch (err) {
        // Network or server error covering the whole batch.  Revert
        // status so the loop retries with backoff.
        for (const op of ops) {
          const next = op.attemptCount + 1;
          await setOutboxStatus(op.clientOpId, 'transient_retry', {
            attemptCount: next,
            nextEarliestAttemptAt: new Date(Date.now() + backoffMs(next)).toISOString(),
            serverReason: err instanceof Error ? err.message : 'network error',
          });
        }
        syncStateStore.set('error');
        return;
      }
      await this.applyOutcomes(ops, outcomes);
      this.fireCycleDone();
      const pending = await countPending();
      this.refreshIndicator(pending);
    });
  }

  private async applyOutcomes(ops: OutboxEntry[], outcomes: OperationOutcome[]): Promise<void> {
    const db = getLocalDb();
    const byOpId = new Map(outcomes.map((o) => [o.clientOpId, o]));
    for (const op of ops) {
      const outcome = byOpId.get(op.clientOpId);
      if (!outcome) {
        // Server didn't return an outcome for this op.  Treat as
        // transient -- the ack got lost; we'll retry the same op.
        const next = op.attemptCount;
        await setOutboxStatus(op.clientOpId, 'transient_retry', {
          attemptCount: next,
          nextEarliestAttemptAt: new Date(Date.now() + backoffMs(next)).toISOString(),
          serverReason: 'no outcome returned',
        });
        continue;
      }
      switch (outcome.status) {
        case 'applied': {
          // Stamp the new server revision into the local row so future
          // patches use it as their baseRevision.  Then drop the op.
          if (typeof outcome.newRevision === 'number') {
            await this.stampRevision(op.entityClass, op.entityId, outcome.newRevision);
          }
          await db.outbox.delete(op.clientOpId);
          break;
        }
        case 'rejected':
        case 'unauthorized':
        case 'conflict':
          await this.rollbackLocally(op, outcome);
          break;
        case 'stale_base': {
          // For patch ops: if the server returned the current entity, re-enqueue
          // with the updated revision rather than rolling back. This avoids error
          // toasts when patchMany enqueues multiple fields with the same snapshot
          // revision — the first op advances the server, making later ops stale
          // even though they are valid changes that haven't been applied yet.
          //
          // Two guards before re-enqueueing:
          //
          // 1. Only retry if `latestEntity[fieldPath] === op.prevValue` — i.e.
          //    the server hasn't independently changed *this* field (another
          //    tab or device). If someone else changed it we treat it as a real
          //    conflict and roll back normally.
          //
          // 2. Only retry if no newer pending op for the same coalesce key
          //    already exists. If the user queued a follow-up edit to the same
          //    field while this one was in-flight, re-enqueueing the older
          //    attemptedValue would clobber that newer pending op via the
          //    same-field coalescing in enqueueFieldPatch. Instead, just stamp
          //    the revision and delete our stale op; the newer op will cycle
          //    through this handler on the next drain with the updated revision.
          if (
            op.command === 'patch' &&
            op.fieldPath !== undefined &&
            outcome.latestEntity &&
            typeof outcome.latestEntity === 'object'
          ) {
            const entity = outcome.latestEntity as Record<string, unknown>;
            const newRevision = typeof entity.revision === 'number' ? entity.revision : undefined;
            // Guard 1: field not independently changed by another source.
            const fieldUnchanged = entity[op.fieldPath] === op.prevValue;
            if (newRevision !== undefined && fieldUnchanged) {
              await this.stampRevision(op.entityClass, op.entityId, newRevision);
              await db.outbox.delete(op.clientOpId);
              // Guard 2: no newer pending op for this field already queued.
              const ckey = coalesceKey(op.entityId, op.fieldPath);
              const newerPending = await db.outbox
                .where('coalesceKey')
                .equals(ckey)
                .filter((row) => row.status === 'pending' || row.status === 'transient_retry')
                .first();
              if (!newerPending) {
                await enqueueFieldPatch({
                  entityClass: op.entityClass,
                  entityId: op.entityId,
                  fieldPath: op.fieldPath,
                  attemptedValue: op.attemptedValue,
                  prevValue: entity[op.fieldPath],
                  baseRevision: newRevision,
                  humanName: op.humanName,
                  flashKey: op.flashKey,
                  characterId: op.parentId ?? undefined,
                });
              } else {
                // Refresh the superseding op so Guard 1 passes on its next
                // drain: its prevValue was captured against an intermediate
                // optimistic Dexie state, not the server's current value.
                await db.outbox.update(newerPending.clientOpId, {
                  baseRevision: newRevision,
                  prevValue: entity[op.fieldPath],
                });
              }
              break;
            }
          }
          await this.rollbackLocally(op, outcome);
          break;
        }
        case 'transient': {
          if (op.attemptCount >= MAX_ATTEMPTS) {
            await this.failPermanently(op, outcome);
          } else {
            await setOutboxStatus(op.clientOpId, 'transient_retry', {
              attemptCount: op.attemptCount,
              nextEarliestAttemptAt: new Date(
                Date.now() + backoffMs(op.attemptCount),
              ).toISOString(),
              serverReason: outcome.reason,
            });
          }
          break;
        }
        case 'suspended': {
          await this.failPermanently(op, outcome);
          break;
        }
      }
    }
  }

  private async rollbackLocally(op: OutboxEntry, outcome: OperationOutcome): Promise<void> {
    const db = getLocalDb();
    // Revert the local Dexie row to the pre-mutation value when we have
    // one.  The server may also have returned a `latestEntity` (for
    // stale_base / conflict); prefer that since it's more recent.
    if (outcome.latestEntity && typeof outcome.latestEntity === 'object') {
      await this.applyServerRow(op.entityClass, outcome.latestEntity as Record<string, unknown>, {
        ignoreOutboxConflict: true,
      });
    } else if (op.command === 'patch' && op.fieldPath !== undefined && op.prevValue !== undefined) {
      await this.revertField(op.entityClass, op.entityId, op.fieldPath, op.prevValue);
    } else if (op.command === 'create') {
      // Local row was speculative; remove it.
      await this.deleteLocal(op.entityClass, op.entityId);
    } else if (op.command === 'delete' && op.prevValue !== undefined) {
      // Re-insert the row we deleted locally.
      await this.reinsertLocal(op.entityClass, op.prevValue);
    }
    // Persistent toast + flash event so the input animates.
    await this.recordRejection(op, outcome);
    syncStateStore.set('error');
    if (op.fieldPath) {
      flashBus.emit({
        key: makeFlashKey(op.entityClass, op.entityId, op.fieldPath),
        reason: outcome.reason ?? 'sync rejected',
      });
    }
    await db.outbox.delete(op.clientOpId);
  }

  private async failPermanently(op: OutboxEntry, outcome: OperationOutcome): Promise<void> {
    const db = getLocalDb();
    await setOutboxStatus(op.clientOpId, 'failed_permanent', {
      serverReason: outcome.reason ?? 'sync failed',
    });
    // Reuse the rejection record path with a synthesized 'failed_permanent'
    // status by writing directly (recordRejection doesn't accept that
    // status because it mirrors OperationOutcome).
    const rec: RejectionRecord = {
      id: op.clientOpId,
      clientOpId: op.clientOpId,
      entityClass: op.entityClass,
      entityId: op.entityId,
      fieldPath: op.fieldPath,
      humanName: op.humanName,
      reason: outcome.reason ?? 'sync failed (max attempts)',
      status: 'failed_permanent',
      createdAt: new Date().toISOString(),
    };
    await db.rejectionToasts.put(rec);
    notifyRejection(rec);
    syncStateStore.set('error');
  }

  private async recordRejection(op: OutboxEntry, outcome: OperationOutcome): Promise<void> {
    const db = getLocalDb();
    const status: RejectionRecord['status'] =
      outcome.status === 'rejected' ||
      outcome.status === 'unauthorized' ||
      outcome.status === 'conflict'
        ? outcome.status
        : 'rejected';
    const rec: RejectionRecord = {
      id: op.clientOpId,
      clientOpId: op.clientOpId,
      entityClass: op.entityClass,
      entityId: op.entityId,
      fieldPath: op.fieldPath,
      humanName: op.humanName,
      reason: outcome.reason ?? 'sync failed',
      status: status as RejectionRecord['status'],
      createdAt: new Date().toISOString(),
    };
    await db.rejectionToasts.put(rec);
    notifyRejection(rec);
  }

  private async applyCursorResponse(res: SyncCursorResponse): Promise<void> {
    const db = getLocalDb();
    if (!res.changes || res.changes.length === 0) {
      // Still advance per-class cursors if the server reported any.
      await this.persistCursors(res.nextCursor);
      return;
    }
    // Apply in a single transaction so observers see one atomic update.
    const stores = [
      db.characters,
      db.characterTraits,
      db.characterSkills,
      db.characterInventory,
      db.characterCombat,
      db.campaigns,
      db.tombstones,
      db.syncCursors,
      db.outbox,
    ];
    await db.transaction('rw', stores, async () => {
      for (const change of res.changes) {
        if (change.command === 'delete') {
          await this.deleteLocal(change.entityClass, change.entityId);
          await db.tombstones.put({
            entityClass: change.entityClass,
            entityId: change.entityId,
            revision: change.revision,
            deletedAt: change.deletedAt ?? new Date().toISOString(),
          });
        } else if (change.data && typeof change.data === 'object') {
          await this.applyServerRow(change.entityClass, change.data as Record<string, unknown>, {});
        }
      }
      await this.persistCursors(res.nextCursor);
    });
  }

  private async persistCursors(
    next: Partial<Record<EntityClass, number>> | undefined,
  ): Promise<void> {
    if (!next) return;
    const db = getLocalDb();
    for (const [entityClass, revision] of Object.entries(next)) {
      if (typeof revision !== 'number') continue;
      await db.syncCursors.put({ entityClass: entityClass as EntityClass, revision });
    }
  }

  private async readCursors(): Promise<Array<{ entityClass: EntityClass; sinceRevision: number }>> {
    const db = getLocalDb();
    const existing = await db.syncCursors.toArray();
    const lookup = new Map(existing.map((c) => [c.entityClass, c.revision]));
    return ALL_ENTITY_CLASSES.map((entityClass) => ({
      entityClass,
      sinceRevision: lookup.get(entityClass) ?? 0,
    }));
  }

  private async stampRevision(
    entityClass: EntityClass,
    entityId: string,
    revision: number,
  ): Promise<void> {
    const db = getLocalDb();
    switch (entityClass) {
      case 'character':
        await db.characters.update(entityId, { revision });
        return;
      case 'character_trait':
        await db.characterTraits.update(entityId, { revision });
        return;
      case 'character_skill':
        await db.characterSkills.update(entityId, { revision });
        return;
      case 'character_inventory':
        await db.characterInventory.update(entityId, { revision });
        return;
      case 'character_combat':
        await db.characterCombat.update(entityId, { revision });
        return;
      default:
        return;
    }
  }

  private async revertField(
    entityClass: EntityClass,
    entityId: string,
    fieldPath: string,
    prevValue: unknown,
  ): Promise<void> {
    const db = getLocalDb();
    const updates = { [fieldPath]: prevValue, updatedAt: new Date().toISOString() };
    switch (entityClass) {
      case 'character':
        await db.characters.update(entityId, updates as Partial<LocalCharacter>);
        return;
      case 'character_trait':
        await db.characterTraits.update(entityId, updates as Partial<LocalCharacterTrait>);
        return;
      case 'character_skill':
        await db.characterSkills.update(entityId, updates as Partial<LocalCharacterSkill>);
        return;
      case 'character_inventory':
        await db.characterInventory.update(entityId, updates as Partial<LocalCharacterInventory>);
        return;
      case 'character_combat':
        await db.characterCombat.update(entityId, updates as Partial<LocalCharacterCombat>);
        return;
      default:
        return;
    }
  }

  private async deleteLocal(entityClass: EntityClass, entityId: string): Promise<void> {
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
      case 'character_inventory':
        await db.characterInventory.delete(entityId);
        return;
      case 'character_combat':
        await db.characterCombat.delete(entityId);
        return;
      case 'campaign':
        await db.campaigns.delete(entityId);
        return;
      default:
        return;
    }
  }

  private async reinsertLocal(entityClass: EntityClass, prevValue: unknown): Promise<void> {
    if (!prevValue || typeof prevValue !== 'object') return;
    await this.applyServerRow(entityClass, prevValue as Record<string, unknown>, {
      ignoreOutboxConflict: true,
    });
  }

  /**
   * Write a server-shaped row into the appropriate Dexie store.  Skips
   * fields that have a pending/in_flight outbox op for that
   * (entityId, fieldPath) -- the local user intent always wins until
   * the server formally rejects it.
   */
  private async applyServerRow(
    entityClass: EntityClass,
    row: Record<string, unknown>,
    opts: { ignoreOutboxConflict?: boolean },
  ): Promise<void> {
    const db = getLocalDb();
    const id =
      entityClass === 'character_combat'
        ? (row.characterId as string | undefined)
        : (row.id as string | undefined);
    if (!id) return;
    const merged: Record<string, unknown> = { ...row };
    if (!opts.ignoreOutboxConflict) {
      const dirty = await db.outbox
        .where('entityId' as never)
        .equals(id)
        .and((o) => o.status === 'pending' || o.status === 'in_flight')
        .toArray()
        .catch(() => [] as OutboxEntry[]);
      for (const op of dirty) {
        if (op.fieldPath && op.fieldPath in merged) {
          // Caller had a pending edit on this field; keep the local
          // value, drop the server's.
          delete merged[op.fieldPath];
        }
      }
    }
    switch (entityClass) {
      case 'character': {
        const existing = await db.characters.get(id);
        await db.characters.put({ ...(existing ?? {}), ...merged } as LocalCharacter);
        return;
      }
      case 'character_trait': {
        const existing = await db.characterTraits.get(id);
        await db.characterTraits.put({ ...(existing ?? {}), ...merged } as LocalCharacterTrait);
        return;
      }
      case 'character_skill': {
        const existing = await db.characterSkills.get(id);
        await db.characterSkills.put({ ...(existing ?? {}), ...merged } as LocalCharacterSkill);
        return;
      }
      case 'character_inventory': {
        const existing = await db.characterInventory.get(id);
        await db.characterInventory.put({
          ...(existing ?? {}),
          ...merged,
        } as LocalCharacterInventory);
        return;
      }
      case 'character_combat': {
        const characterId = (row.characterId as string) ?? id;
        const existing = await db.characterCombat.get(characterId);
        await db.characterCombat.put({
          ...(existing ?? {}),
          ...merged,
          characterId,
        } as LocalCharacterCombat);
        return;
      }
      case 'campaign': {
        const existing = await db.campaigns.get(id);
        await db.campaigns.put({ ...(existing ?? {}), ...merged } as Record<
          string,
          unknown
        > as never);
        return;
      }
      default:
        return;
    }
  }

  private async replayRejectionToasts(): Promise<void> {
    const db = getLocalDb();
    const open = await db.rejectionToasts
      .where('dismissedAt')
      .equals('')
      .or('dismissedAt')
      .equals(undefined as unknown as string)
      .toArray()
      .catch(() => [] as RejectionRecord[]);
    for (const r of open) notifyRejection(r);
  }

  /**
   * Walk local Dexie state and drop private child rows for any
   * character the viewer is now restricted to seeing in minimal form.
   * See `minimalViewSweep.ts` for the pure decision and the rationale
   * (Codex review on PR #22 — without this, share=false flips leave
   * already-cached private data reachable in IndexedDB).
   *
   * No-op when the orchestrator hasn't captured a user id yet (i.e.
   * before bootstrap finishes) — the periodic timer races with that
   * window and we don't want to mis-classify the empty user as
   * "non-owner non-GM of every campaign."
   */
  private async enforceMinimalViewLocally(): Promise<void> {
    const viewerId = this.currentUserId;
    if (!viewerId) return;
    const db = getLocalDb();
    const [chars, camps] = await Promise.all([db.characters.toArray(), db.campaigns.toArray()]);
    const ids = characterIdsToMinimize({
      viewerId,
      characters: chars,
      campaigns: camps,
    });
    if (ids.size === 0) return;
    const idArray = [...ids];
    // One transaction across the four child tables so the purge is
    // atomic — can't have skills present and traits gone halfway.
    await db.transaction(
      'rw',
      [db.characterTraits, db.characterSkills, db.characterInventory, db.characterCombat],
      async () => {
        await db.characterTraits.where('characterId').anyOf(idArray).delete();
        await db.characterSkills.where('characterId').anyOf(idArray).delete();
        await db.characterInventory.where('characterId').anyOf(idArray).delete();
        // Combat is keyed by characterId (1:1).
        await db.characterCombat.where('id').anyOf(idArray).delete();
      },
    );
  }

  private fireCycleDone(): void {
    for (const cb of this.cycleListeners) cb();
  }

  private refreshIndicator(pending: number): void {
    if (pending > 0) {
      syncStateStore.set('syncing');
    } else {
      syncStateStore.set('synced');
    }
  }
}

function toEnvelope(op: OutboxEntry): OperationEnvelope {
  return {
    clientOpId: op.clientOpId,
    entityClass: op.entityClass,
    entityId: op.entityId,
    command: op.command,
    fieldPath: op.fieldPath,
    attemptedValue: op.attemptedValue,
    prevValue: op.prevValue,
    baseRevision: op.baseRevision,
    parentId: op.parentId,
    validationVersion: op.validationVersion,
    createdAt: op.enqueuedAt,
  };
}

/**
 * Guarded against SSR / older browsers that don't support
 * navigator.locks.  Falls back to a same-tab promise queue.
 */
const sameTabLocks = new Map<string, Promise<void>>();

async function runWithLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
    return await navigator.locks.request(name, async () => {
      return await fn();
    });
  }
  // Same-tab fallback: serialize via a per-name promise chain.  Doesn't
  // protect across tabs, but in dev/test this is enough.
  const prev = sameTabLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((res) => {
    release = res;
  });
  sameTabLocks.set(
    name,
    prev.then(() => next),
  );
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

// ---------- toast bridge ----------
//
// The orchestrator runs outside React, but persistent rejection toasts
// need to be pushed through `useToasts()` (a Context).  We expose a
// pluggable handler that the SyncProvider sets at mount time so the
// orchestrator stays React-agnostic.

export type RejectionNotifier = (rec: RejectionRecord) => void;

let activeNotifier: RejectionNotifier | null = null;

export function setRejectionNotifier(notifier: RejectionNotifier | null): void {
  activeNotifier = notifier;
}

function notifyRejection(rec: RejectionRecord): void {
  activeNotifier?.(rec);
}

// ---------- singleton + accessor ----------

let orchestratorInstance: SyncOrchestrator | null = null;

export function getSyncOrchestrator(): SyncOrchestrator {
  if (!orchestratorInstance) orchestratorInstance = new SyncOrchestrator();
  return orchestratorInstance;
}

/** Test helper -- replace the singleton with a fresh one. */
export function resetSyncOrchestratorForTests(): void {
  if (orchestratorInstance) orchestratorInstance.stop();
  orchestratorInstance = null;
}

export type { OperationEnvelope, OperationOutcome };
