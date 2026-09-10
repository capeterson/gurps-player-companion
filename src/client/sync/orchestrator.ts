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
 * that has a `pending`, `in_flight`, or `transient_retry` outbox op
 * for the same (entityId, fieldPath).  See `applyServerRow`.
 */

import { liveQuery } from 'dexie';
import { libraryMechanics } from '../../shared/schemas/libraryMechanics.ts';
import type {
  EntityClass,
  OperationEnvelope,
  OperationOutcome,
  SyncCursorChange,
  SyncCursorResponse,
  SyncOperationsResponse,
} from '../../shared/schemas/sync.ts';
import {
  ALL_STORE_NAMES,
  type LocalCharacter,
  type LocalCharacterCombat,
  type LocalCharacterInventory,
  type LocalCharacterLanguage,
  type LocalCharacterSkill,
  type LocalCharacterSpell,
  type LocalCharacterTechnique,
  type LocalCharacterTrait,
  type OutboxEntry,
  type RejectionRecord,
  coalesceKey,
  getLocalDb,
} from '../db/dexie.ts';
import { ApiError, api } from '../lib/api.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { clearActiveUser } from './activeUser.ts';
import { flashBus, makeFlashKey } from './flashBus.ts';
import {
  mergeCampaignTransferUndo,
  restoreLocalCampaignReferences,
} from './localCampaignTransfer.ts';
import { characterIdsToMinimize } from './minimalViewSweep.ts';
import {
  backoffMs,
  countPending,
  enqueueFieldPatch,
  readDrainableOps,
  recoverStaleInFlight,
  setOutboxStatus,
} from './outbox.ts';
import { syncStateStore } from './state.ts';
import {
  appendSyncLog,
  pruneRejectionToasts,
  redactSyncLogForCharacters,
  rememberRevokedCharacters,
  snapshotValue,
} from './syncLog.ts';

const ALL_ENTITY_CLASSES: EntityClass[] = [
  'character',
  'character_trait',
  'character_skill',
  'character_spell',
  'character_language',
  'character_technique',
  'character_inventory',
  'character_combat',
  // Campaigns are pulled READ-ONLY: rows land in Dexie so
  // `enforceMinimalViewLocally` can evaluate shareCharacterSheets and
  // `useCharacterDetail` can resolve campaign names offline.  Campaign
  // *mutations* still go through the REST routes — there is no outbox
  // path for them (see AGENTS.md S0).
  'campaign',
];

const DRAIN_BATCH_SIZE = 50;
const PERIODIC_PULL_MS = 30_000;
const BOOTSTRAP_RETRY_MS = 5_000;

/**
 * Cross-tab lock names.  Lock order is always DRAIN → CURSOR (the
 * drain loop pulls the cursor while holding the drain lock); no path
 * may acquire them in the opposite order or Web Locks will deadlock.
 */
const DRAIN_LOCK = 'sync-drain';
const CURSOR_LOCK = 'sync-cursor';

/**
 * Compare a server field value with the locally-stored prevValue.
 *
 * Drizzle returns DECIMAL/NUMERIC columns as strings (e.g. "2.5") while
 * Dexie stores them as numbers.  We coerce *only* when there is a
 * string↔number type mismatch so plain text fields (height, name, notes,
 * etc.) are still compared verbatim — changing "6" to "06" must not look
 * equal and trigger a silent overwrite instead of a conflict rollback.
 *
 * For jsonb columns (armor, weaponData, powerstoneData, magicItemData,
 * trait modifiers, etc.) the server returns a freshly-parsed object,
 * not the same reference the client stored.  We fall through to a
 * structural deep-equal so the stale-base reconciliation correctly
 * recognises "this field is unchanged from what I last knew" —
 * otherwise rapid jsonb edits race and rollback even when the server
 * value matches the queued prevValue.
 */
export function fieldValuesEqual(serverVal: unknown, storedVal: unknown): boolean {
  if (serverVal === storedVal) return true;
  // Coerce only on string↔number mismatch (Drizzle decimal string vs. Dexie number).
  if (typeof serverVal === 'string' && typeof storedVal === 'number') {
    const n = Number(serverVal);
    return Number.isFinite(n) && n === storedVal;
  }
  if (typeof serverVal === 'number' && typeof storedVal === 'string') {
    const n = Number(storedVal);
    return Number.isFinite(n) && n === serverVal;
  }
  if (Array.isArray(serverVal) && Array.isArray(storedVal)) {
    if (serverVal.length !== storedVal.length) return false;
    for (let i = 0; i < serverVal.length; i++) {
      if (!fieldValuesEqual(serverVal[i], storedVal[i])) return false;
    }
    return true;
  }
  if (
    serverVal !== null &&
    storedVal !== null &&
    typeof serverVal === 'object' &&
    typeof storedVal === 'object' &&
    !Array.isArray(serverVal) &&
    !Array.isArray(storedVal)
  ) {
    const a = serverVal as Record<string, unknown>;
    const b = storedVal as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!fieldValuesEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

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
  private recoveryInProgress = false;
  private bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The viewer's user id. Used by `enforceMinimalViewLocally` to figure
   * out which campaign-shared characters the viewer may see in detail,
   * and by `reportSessionLost` to tell "never signed in" apart from
   * "session vanished underneath us".
   *
   * Seeded by `setCurrentUser` on every authenticated mount, NOT only
   * at bootstrap: `SyncBootstrapGate` calls `bootstrap()` only when the
   * `bootstrap:<userId>` flag is absent, so on an ordinary reload — the
   * common path — this would otherwise stay null for the whole session,
   * silently disabling both of those.
   */
  private currentUserId: string | null = null;
  /** Latches `reportSessionLost` so a lost session logs once, not every cycle. */
  private sessionLostReported = false;
  /** Latches rejection prune+replay to once per signed-in session. */
  private rejectionHousekeepingDone = false;
  /**
   * False while a cycle failure is outstanding. Cleared only by a
   * cycle that actually succeeds -- see `refreshIndicator`.
   */
  private syncHealthy = true;

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
    if (this.bootstrapRetryTimer) clearTimeout(this.bootstrapRetryTimer);
    this.bootstrapRetryTimer = null;
    this.outboxLiveSub?.unsubscribe();
    this.outboxLiveSub = null;
    this.wake();
  }

  /** Force the drain loop to re-evaluate immediately. */
  triggerDrain(): void {
    this.wake();
  }

  /**
   * Record who is signed in.  Called on every authenticated mount, not
   * just at bootstrap -- see `currentUserId`.  Switching users re-arms
   * the session-loss latch so the new session can report its own loss.
   */
  setCurrentUser(userId: string): void {
    if (this.currentUserId === userId) {
      // Same user, but the notifier may only now be wired up.
      void this.maybeRunRejectionHousekeeping();
      return;
    }
    this.currentUserId = userId;
    this.sessionLostReported = false;
    this.rejectionHousekeepingDone = false;
    void this.maybeRunRejectionHousekeeping();
  }

  /**
   * Prune + replay open rejection toasts, once per signed-in session.
   *
   * This used to happen only inside `bootstrap()`, which the gate skips
   * whenever `bootstrap:<userId>` already exists — i.e. on every
   * ordinary reload. The consequences were that an undismissed rollback
   * toast did NOT survive a reload (the whole point of persisting it),
   * and that `pruneRejectionToasts` never ran for a long-lived account,
   * so the pile-up it exists to prevent came back.
   *
   * Waits for the notifier: `SyncProvider` registers it in a mount
   * effect that can land after the gate sets the user, and replaying
   * into a null notifier would silently drop every toast.
   */
  /** Called when a rejection notifier registers; see `setRejectionNotifier`. */
  async flushPendingRejectionReplay(): Promise<void> {
    await this.maybeRunRejectionHousekeeping();
  }

  private async maybeRunRejectionHousekeeping(): Promise<void> {
    if (this.rejectionHousekeepingDone) return;
    if (this.currentUserId === null) return;
    if (!hasRejectionNotifier()) return;
    this.rejectionHousekeepingDone = true;
    await this.replayRejectionToasts();
  }

  /**
   * Pull /sync/cursor for every known entity class and apply the
   * results into Dexie.  Safe to call repeatedly; each class's cursor
   * is the high-water mark seen so far.
   *
   * Serialized under CURSOR_LOCK so a periodic pull can never
   * interleave with bootstrap's cursor-clear (the race would persist
   * a stale pre-clear cursor and leave a permanent gap in local data).
   */
  async triggerCursorPull(force = false): Promise<void> {
    await runWithLock(CURSOR_LOCK, async () => {
      await this.pullInner(force);
    });
  }

  /**
   * The cursor-pull body.  Callers must hold CURSOR_LOCK.  Returns
   * true when the pull actually ran to completion, false when it was
   * skipped (recovery in progress, logged out, offline) -- bootstrap
   * uses the distinction to decide whether the per-user bootstrapped
   * flag may be written.
   */
  private async pullInner(force: boolean): Promise<boolean> {
    if (this.recoveryInProgress && !force) return false;
    if (!tokenStore.read()) {
      // A session that vanished *after* bootstrap wasn't a sign-out --
      // something invalidated it underneath the user (see the refresh
      // handling in lib/api.ts).  Say so: every later cycle bails right
      // here without touching the indicator, so staying quiet freezes
      // the badge on its last value with nothing to explain it.
      if (this.currentUserId !== null) {
        this.reportSessionLost();
      }
      return false;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    // Don't flip the indicator to 'syncing' just to *check* for changes —
    // the periodic loop polls every 5s and would otherwise leave the
    // badge perpetually flickering between 'syncing' and 'synced' even
    // when nothing is actually moving. Defer the flip until we see a
    // response that actually carries rows to apply.
    let appliedAnything = false;
    let lastAccessible: SyncCursorResponse['accessible'];
    try {
      let hasMore = true;
      while (hasMore) {
        const cursors = await this.readCursors();
        const res = await api<SyncCursorResponse>('/sync/cursor', {
          method: 'POST',
          body: { cursors, pageSize: 200 },
        });
        if (!appliedAnything && res.changes && res.changes.length > 0) {
          syncStateStore.set('syncing');
          appliedAnything = true;
        }
        await this.applyCursorResponse(res);
        lastAccessible = res.accessible;
        hasMore = Object.values(res.hasMore ?? {}).some((v) => v);
      }
      // After every successful pull, drop any private child rows that
      // were synced earlier but the viewer is no longer allowed to see
      // (campaign was just flipped to shareCharacterSheets=false). The
      // server stops emitting them as upserts; this sweep cleans up
      // what's already in Dexie.
      const needsRehydrate = await this.enforceMinimalViewLocally();
      if (needsRehydrate) {
        const db = getLocalDb();
        await db.syncCursors.bulkDelete([
          'character',
          'character_trait',
          'character_skill',
          'character_spell',
          'character_language',
          'character_technique',
          'character_inventory',
          'character_combat',
        ]);
        return await this.pullInner(force);
      }
      // Prune characters/campaigns the viewer has lost access to
      // entirely (removed from a campaign, campaign deleted, character
      // moved out of a shared campaign). Tombstones can't reach ex-
      // members -- they're scoped to campaigns the viewer *currently*
      // belongs to -- so the authoritative `accessible` set on the last
      // page is the only signal. Absent on old servers -> no-op.
      await this.pruneInaccessibleLocally(lastAccessible);
      this.fireCycleDone();
      // A pull that completed is the one thing that clears an
      // outstanding failure.
      this.syncHealthy = true;
      const pending = await countPending();
      this.refreshIndicator(pending);
      return true;
    } catch (err) {
      // Leave a trace.  A failing pull produces no outbox row, no
      // rejection record and no toast, so before this the only symptom
      // was a red badge telling the user to go read a toast that never
      // existed.
      this.markCycleFailed();
      await reportCycleFailure(err, 'Downloading server changes failed', 'pull');
      throw err;
    }
  }

  /**
   * The session disappeared mid-run.  Surfaces it once (not on every
   * 5s cycle) as a red badge with an actionable reason plus a journal
   * entry, instead of silently going quiet.
   */
  private reportSessionLost(): void {
    if (this.sessionLostReported) return;
    this.sessionLostReported = true;
    const reason = 'Signed out — sign in again to resume syncing';
    this.markCycleFailed();
    void appendSyncLog({ direction: 'local', result: 'failed', reason });
    syncStateStore.setError(reason);
  }

  /**
   * Initial-snapshot pull on a fresh login.  Same as `triggerCursorPull`
   * except it always starts from cursor 0 and writes a per-user
   * "bootstrapped" flag so the SyncBootstrapGate can render the UI
   * straight away on subsequent loads.
   *
   * The cursor-clear + pull + flag-write run as one CURSOR_LOCK
   * critical section: without it, a periodic pull that started before
   * the clear could persist its (previous-account or pre-clear) cursor
   * AFTER the clear, making the from-zero pull silently skip
   * everything below that revision — a permanent local data hole.
   *
   * If the pull is skipped (offline, recovery) or fails, the flag is
   * NOT written and a retry is scheduled, so a first login on a flaky
   * connection self-heals instead of leaving the gate spinning until
   * a manual reload.
   */
  async bootstrap(userId: string, forceCursorPull = false): Promise<boolean> {
    // Captured for `enforceMinimalViewLocally` — the periodic
    // cursor-pull doesn't otherwise know who's logged in.
    this.currentUserId = userId;
    const db = getLocalDb();
    const flagKey = `bootstrap:${userId}`;
    let completed = false;
    try {
      completed = await runWithLock(CURSOR_LOCK, async () => {
        const flag = await db.syncMeta.get(flagKey);
        if (!flag) {
          // Wipe any per-class cursors carried over from a previous
          // account so we definitely start at 0 and pull every owned row.
          await db.syncCursors.clear();
        }
        const ran = await this.pullInner(forceCursorPull);
        if (ran) {
          await db.syncMeta.put({
            key: flagKey,
            value: { bootstrappedAt: new Date().toISOString() },
          });
        }
        return ran;
      });
    } finally {
      if (!completed) this.scheduleBootstrapRetry(userId);
    }
    if (!completed) return false;
    // Re-emit any persistent rejection toasts that survived the
    // reload so the user doesn't lose an open error.
    this.rejectionHousekeepingDone = true;
    await this.replayRejectionToasts();
    return true;
  }

  /**
   * Retry a skipped/failed bootstrap in the background.  The
   * SyncBootstrapGate fires `bootstrap()` exactly once per login; if
   * that attempt can't complete there is otherwise nothing to try
   * again, and the gate spins forever.
   */
  private scheduleBootstrapRetry(userId: string): void {
    if (this.bootstrapRetryTimer) return;
    this.bootstrapRetryTimer = setTimeout(() => {
      this.bootstrapRetryTimer = null;
      if (this.currentUserId !== userId) return;
      if (!tokenStore.read()) return;
      void this.bootstrap(userId).catch(() => {
        /* bootstrap re-schedules itself on failure */
      });
    }, BOOTSTRAP_RETRY_MS);
  }

  /**
   * Destructive recovery path for unrecoverable local sync errors.
   *
   * This intentionally discards pending outbox edits, clears the same
   * per-user Dexie tables as logout, resets the visible sync state, and
   * then runs a forced bootstrap from revision 0 for the supplied user.
   * Callers must require explicit user confirmation before invoking it.
   */
  async clearLocalAndFullResync(userId: string): Promise<void> {
    if (!tokenStore.read()) {
      throw new Error('Cannot resync without an authenticated session');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Cannot resync while offline');
    }

    const wasStarted = this.started;
    this.recoveryInProgress = true;
    this.running = false;
    this.wake();

    try {
      await runWithLock(DRAIN_LOCK, async () => {
        await this.clearAllLocalStores();
        syncStateStore.reset('syncing');
        this.currentUserId = userId;
        const completed = await this.bootstrap(userId, true);
        if (!completed) throw new Error('Fresh server data could not be downloaded');
      });
    } finally {
      this.recoveryInProgress = false;
      if (wasStarted) {
        this.running = false;
        void this.runLoop();
        this.wake();
      }
    }
  }

  /** Explicitly discard one repeatedly failing optimistic operation. */
  async revertFailedOperation(
    clientOpId: string,
  ): Promise<OutboxEntry & { preservedNewerEdit?: boolean }> {
    let reverted: (OutboxEntry & { preservedNewerEdit?: boolean }) | undefined;
    await runWithLock(DRAIN_LOCK, async () => {
      const db = getLocalDb();
      const op = await db.outbox.get(clientOpId);
      if (!op) throw new Error('This change is no longer pending');
      if ((op.status !== 'transient_retry' && op.status !== 'pending') || op.attemptCount < 4) {
        throw new Error('This change is not eligible to be reverted');
      }
      let preservedNewerEdit = false;
      // What the local field actually ends up holding, for the journal.
      // Usually `prevValue`, but a superseding edit deliberately keeps
      // the user's newer value instead.
      let restoredValue: unknown = op.prevValue;
      if (op.command === 'patch' && op.fieldPath !== undefined) {
        const preserved = await this.revertLocal(op, {
          clientOpId: op.clientOpId,
          status: 'rejected',
        });
        preservedNewerEdit = preserved !== undefined;
        restoredValue = preserved ? preserved.preservedValue : op.prevValue;
      } else if (op.command === 'create') {
        await this.discardSpeculativeCreate(op);
      } else if (op.command === 'delete') {
        await this.reinsertLocal(op.entityClass, op.prevValue);
      }
      await db.outbox.delete(op.clientOpId);
      await appendSyncLog({
        direction: 'local',
        result: 'reverted',
        entityClass: op.entityClass,
        entityId: op.entityId,
        parentId: op.parentId,
        command: op.command,
        fieldPath: op.fieldPath,
        humanName: op.humanName,
        reason: preservedNewerEdit
          ? `Failed attempt discarded by user after ${op.attemptCount} attempts; a newer local edit was kept${
              op.serverReason ? ` — ${op.serverReason}` : ''
            }`
          : op.serverReason
            ? `Discarded by user after ${op.attemptCount} failed attempts — ${op.serverReason}`
            : `Discarded by user after ${op.attemptCount} failed attempts`,
        // Direction of travel is inverted here: the local row moved away
        // from `attemptedValue`.  It lands on `prevValue` normally, but
        // on the superseding-edit path it keeps the user's newer value
        // instead -- claiming it went back to the old server value would
        // contradict what the field visibly shows.
        previousValue: snapshotValue(op.attemptedValue),
        newValue: snapshotValue(restoredValue),
      });
      if (op.fieldPath) {
        flashBus.emit({
          key: op.flashKey ?? makeFlashKey(op.entityClass, op.entityId, op.fieldPath),
          reason: 'Local change reverted by user',
        });
      }
      reverted = preservedNewerEdit ? { ...op, preservedNewerEdit } : op;
    });
    if (!reverted) throw new Error('Could not revert this change');
    this.wake();
    this.refreshIndicator(await countPending());
    return reverted;
  }

  /** Wipe Dexie and reset state -- called on logout. */
  async purge(): Promise<void> {
    this.currentUserId = null;
    this.rejectionHousekeepingDone = false;
    // The wiped Dexie no longer belongs to anyone.
    clearActiveUser();
    if (this.bootstrapRetryTimer) clearTimeout(this.bootstrapRetryTimer);
    this.bootstrapRetryTimer = null;
    await this.clearAllLocalStores();
    syncStateStore.reset('synced');
  }

  onCycleDone(cb: () => void): () => void {
    this.cycleListeners.add(cb);
    return () => {
      this.cycleListeners.delete(cb);
    };
  }

  // ---------- internals ----------

  private async clearAllLocalStores(): Promise<void> {
    const db = getLocalDb();
    const stores = ALL_STORE_NAMES.map((name) => db[name]);
    await db.transaction('rw', stores, async () => {
      for (const name of ALL_STORE_NAMES) {
        await db[name].clear();
      }
    });
  }

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
      } catch (err) {
        // Anything the inner handlers didn't already account for --
        // recoverStaleInFlight, readDrainableOps, applyOutcomes, a
        // Dexie failure. A bare set('error') here would restore exactly
        // the unexplained red badge this whole change exists to remove.
        this.markCycleFailed();
        await reportCycleFailure(err, 'Sync failed');
      }
      // Wait for an outbox change, an online event, or 5s, whichever
      // comes first.
      await this.waitForSignal(5_000);
    }
  }

  private async maybeDrainOnce(): Promise<void> {
    if (this.recoveryInProgress) return;
    if (!tokenStore.read()) {
      if (this.currentUserId !== null) this.reportSessionLost();
      return;
    }
    // A session is back (re-login, or a refresh that finally succeeded)
    // -- re-arm the latch so a future loss is reported again.
    this.sessionLostReported = false;
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
    await runWithLock(DRAIN_LOCK, async () => {
      // Under the drain lock no POST can be outstanding anywhere, so
      // any row still `in_flight` was orphaned (crash / tab close /
      // error between marking and settling).  Re-promote it so the
      // edit isn't stranded un-syncable forever.
      await recoverStaleInFlight();
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
            lastError: errorDetails(err),
          });
        }
        this.markCycleFailed();
        await reportCycleFailure(err, 'Uploading changes failed', 'push', {
          operationCount: ops.length,
        });
        return;
      }
      await this.applyOutcomes(ops, outcomes);
      // Pull server-side changes immediately after draining so edits from
      // other devices appear right away rather than waiting up to 5 seconds
      // for the next loop iteration.  triggerCursorPull handles its own
      // fireCycleDone + refreshIndicator; the calls below are fallbacks for
      // the early-return paths (offline / no token) where it returns silently.
      let pullFailed = false;
      await this.triggerCursorPull().catch(() => {
        pullFailed = true;
      });
      this.fireCycleDone();
      // Only the *skipped* pull needs the fallback. A pull that FAILED
      // already reported a reason; refreshing the indicator here would
      // flip the badge straight back to 'synced' (the upload emptied the
      // outbox) and drop the banner explaining that downloads are still
      // broken.
      if (pullFailed) return;
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
        const next = op.attemptCount + 1;
        await setOutboxStatus(op.clientOpId, 'transient_retry', {
          attemptCount: next,
          nextEarliestAttemptAt: new Date(Date.now() + backoffMs(next)).toISOString(),
          serverReason: 'no outcome returned',
          lastError: { reason: 'no outcome returned', response: outcomes },
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
          await appendSyncLog({
            direction: 'push',
            result: 'synced',
            entityClass: op.entityClass,
            entityId: op.entityId,
            parentId: op.parentId,
            command: op.command,
            fieldPath: op.fieldPath,
            humanName: op.humanName,
            previousValue: snapshotValue(op.prevValue),
            newValue: snapshotValue(op.attemptedValue),
            details: snapshotValue(outcome),
          });
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
            // fieldValuesEqual handles the Drizzle string↔Dexie number mismatch
            // for DECIMAL columns without false-equating text fields like "6"/"06".
            const fieldUnchanged = fieldValuesEqual(entity[op.fieldPath], op.prevValue);
            if (newRevision !== undefined && fieldUnchanged) {
              const fieldPath = op.fieldPath;
              await db.transaction('rw', ALL_STORE_NAMES, async () => {
                await this.stampRevision(op.entityClass, op.entityId, newRevision);
                await db.outbox.delete(op.clientOpId);
                await appendSyncLog({
                  direction: 'push',
                  result: 'requeued',
                  entityClass: op.entityClass,
                  entityId: op.entityId,
                  parentId: op.parentId,
                  command: op.command,
                  fieldPath: fieldPath,
                  humanName: op.humanName,
                  details: { serverReason: outcome.reason, newRevision },
                });
                // Guard 2: no newer pending op for this field already queued.
                const ckey = coalesceKey(op.entityId, fieldPath);
                const newerPending = await db.outbox
                  .where('coalesceKey')
                  .equals(ckey)
                  .filter((row) => row.status === 'pending' || row.status === 'transient_retry')
                  .first();
                if (!newerPending) {
                  await enqueueFieldPatch({
                    entityClass: op.entityClass,
                    entityId: op.entityId,
                    fieldPath: fieldPath,
                    attemptedValue: op.attemptedValue,
                    prevValue: entity[fieldPath],
                    baseRevision: newRevision,
                    humanName: op.humanName,
                    flashKey: op.flashKey,
                    characterId: op.parentId ?? undefined,
                    // Preserve the original gesture's batch id so a stale_base
                    // retry of one patch in a bulk action (e.g. "Revert all
                    // temporary buffs") stays in the same history fold instead
                    // of falling back to a fresh clientOpId batch.
                    batchId: op.batchId,
                    localCampaignTransferUndo: op.localCampaignTransferUndo,
                  });
                } else {
                  // Refresh the superseding op so Guard 1 passes on its next
                  // drain: its prevValue was captured against an intermediate
                  // optimistic Dexie state, not the server's current value.
                  await db.outbox.update(newerPending.clientOpId, {
                    baseRevision: newRevision,
                    prevValue: entity[fieldPath],
                    localCampaignTransferUndo: mergeCampaignTransferUndo(
                      op.localCampaignTransferUndo,
                      newerPending.localCampaignTransferUndo,
                    ),
                  });
                  await restoreLocalCampaignReferences(
                    mergeCampaignTransferUndo(
                      op.localCampaignTransferUndo,
                      newerPending.localCampaignTransferUndo,
                    ),
                    newerPending.attemptedValue,
                  );
                }
              });
              break;
            }
          }
          await this.rollbackLocally(op, outcome);
          break;
        }
        case 'transient': {
          // Transient failures retry forever -- backoffMs() relaxes to
          // a 5-minute cadence past MAX_ATTEMPTS.  Giving up would
          // strand the optimistic local value diverged from the server
          // with no reconciliation path; retrying self-heals as soon
          // as the server recovers.  The indicator honestly shows
          // 'syncing' the whole time because the op stays counted.
          if (op.status !== 'transient_retry') {
            // Log only on the transition INTO retry -- op.status here
            // still reflects the pre-drain DB state (setOutboxStatus
            // above doesn't mutate this in-memory object), so this
            // fires once per failure streak rather than flushing the
            // 1,000-row journal on every retry of a stubborn op.
            await appendSyncLog({
              direction: 'push',
              result: 'retrying',
              entityClass: op.entityClass,
              entityId: op.entityId,
              parentId: op.parentId,
              command: op.command,
              fieldPath: op.fieldPath,
              humanName: op.humanName,
              details: { serverReason: outcome.reason, attemptCount: op.attemptCount + 1 },
            });
          }
          const next = op.attemptCount + 1;
          await setOutboxStatus(op.clientOpId, 'transient_retry', {
            attemptCount: next,
            nextEarliestAttemptAt: new Date(Date.now() + backoffMs(next)).toISOString(),
            serverReason: outcome.reason,
            lastError: outcome,
          });
          break;
        }
        case 'suspended': {
          await this.failPermanently(op, outcome);
          break;
        }
      }
    }
  }

  /**
   * Revert the local Dexie row to the pre-mutation value when we have
   * one.  The server may also have returned a `latestEntity` (for
   * stale_base / conflict); prefer that since it's more recent.
   */
  private async revertLocal(
    op: OutboxEntry,
    outcome: OperationOutcome,
  ): Promise<{ preservedValue: unknown } | undefined> {
    if (op.command === 'patch' && op.fieldPath !== undefined) {
      const fieldPath = op.fieldPath;
      const db = getLocalDb();
      // Serialize reconciliation with local enqueues: a newer edit must never
      // slip between the lookup and rollback. Exclude only the rejected op
      // when merging a returned server row, preserving every other dirty field.
      return db.transaction('rw', ALL_STORE_NAMES, async () => {
        const newer = await db.outbox
          .where('coalesceKey')
          .equals(coalesceKey(op.entityId, fieldPath))
          .filter(
            (candidate) =>
              candidate.clientOpId !== op.clientOpId &&
              candidate.entityClass === op.entityClass &&
              (candidate.status === 'pending' ||
                candidate.status === 'transient_retry' ||
                candidate.status === 'in_flight'),
          )
          .first();
        const latest =
          outcome.latestEntity && typeof outcome.latestEntity === 'object'
            ? (outcome.latestEntity as Record<string, unknown>)
            : undefined;
        const restored = latest && fieldPath in latest ? latest[fieldPath] : op.prevValue;
        await db.outbox.delete(op.clientOpId);
        if (newer) {
          await db.outbox.update(newer.clientOpId, {
            prevValue: restored,
            localCampaignTransferUndo: mergeCampaignTransferUndo(
              op.localCampaignTransferUndo,
              newer.localCampaignTransferUndo,
            ),
            ...(typeof latest?.revision === 'number' ? { baseRevision: latest.revision } : {}),
          });
        }
        if (latest)
          await this.applyServerRow(op.entityClass, latest, { ignoreOutboxConflict: false });
        else if (!newer && restored !== undefined)
          await this.revertField(op.entityClass, op.entityId, fieldPath, restored);
        if (op.localCampaignTransferUndo)
          await restoreLocalCampaignReferences(
            op.localCampaignTransferUndo,
            newer ? newer.attemptedValue : restored,
          );
        return newer ? { preservedValue: newer.attemptedValue } : undefined;
      });
    }
    if (outcome.latestEntity && typeof outcome.latestEntity === 'object') {
      await this.applyServerRow(op.entityClass, outcome.latestEntity as Record<string, unknown>, {
        ignoreOutboxConflict: true,
      });
    } else if (op.command === 'create') {
      // Local row was speculative; remove it.
      await this.deleteLocal(op.entityClass, op.entityId);
    } else if (op.command === 'delete' && op.prevValue !== undefined) {
      // Re-insert the row we deleted locally.
      await this.reinsertLocal(op.entityClass, op.prevValue);
    }
    return undefined;
  }

  private async rollbackLocally(op: OutboxEntry, outcome: OperationOutcome): Promise<void> {
    const db = getLocalDb();
    // Reconciliation and the durable notice commit together. A storage failure
    // leaves the optimistic row and operation intact for recovery/replay.
    const { preserved, rec } = await db.transaction('rw', ALL_STORE_NAMES, async () => {
      const preserved = await this.revertLocal(op, outcome);
      const rec = await this.recordRejection(op, outcome);
      await db.outbox.delete(op.clientOpId);
      return { preserved, rec };
    });
    notifyRejection(rec);
    syncStateStore.setError(
      `Couldn't sync ${op.humanName ?? op.entityClass} — ${outcome.reason ?? 'sync rejected'}`,
    );
    if (op.fieldPath) {
      flashBus.emit({
        key: makeFlashKey(op.entityClass, op.entityId, op.fieldPath),
        reason: outcome.reason ?? 'sync rejected',
      });
    } else if (op.command === 'create' && op.parentId) {
      flashBus.emit({
        key: makeFlashKey(op.entityClass, op.parentId, 'create'),
        reason: outcome.reason ?? 'sync rejected',
      });
    }
    await appendSyncLog({
      direction: 'push',
      result: 'rolled_back',
      entityClass: op.entityClass,
      entityId: op.entityId,
      parentId: op.parentId,
      command: op.command,
      fieldPath: op.fieldPath,
      humanName: op.humanName,
      reason: outcome.reason ?? 'sync rejected',
      // Before/after describe the LOCAL ROW's movement, and a rollback
      // moves it the other way: away from the value the server refused,
      // back to whatever was restored. Recording the refused value as
      // "After" would show the user the rejected edit as their final
      // state and the restored one as discarded -- backwards.
      ...(preserved
        ? {
            previousValue: snapshotValue(preserved.preservedValue),
            newValue: snapshotValue(preserved.preservedValue),
          }
        : rollbackSnapshot(op, outcome)),
      details: snapshotValue(outcome),
    });
    await db.outbox.delete(op.clientOpId);
  }

  /**
   * Terminal failure (server `suspended` outcome).  Unlike the old
   * behaviour -- which parked the op as `failed_permanent` and left
   * the optimistic local value silently diverged from the server
   * forever -- this reverts the local row so client and server
   * converge, then surfaces the failure as a persistent toast + flash
   * (AGENTS.md rule 2: a rollback is a UX event).  The op row is
   * deleted; the rejectionToasts record is the durable audit trail,
   * same as the rejected/conflict paths.
   */
  private async failPermanently(op: OutboxEntry, outcome: OperationOutcome): Promise<void> {
    const db = getLocalDb();
    const rec: RejectionRecord = {
      id: op.clientOpId,
      clientOpId: op.clientOpId,
      userId: this.currentUserId ?? undefined,
      entityClass: op.entityClass,
      entityId: op.entityId,
      parentId: op.parentId,
      fieldPath: op.fieldPath,
      humanName: op.humanName,
      reason: outcome.reason ?? 'sync failed',
      status: 'failed_permanent',
      createdAt: new Date().toISOString(),
    };
    const preserved = await db.transaction('rw', ALL_STORE_NAMES, async () => {
      const preserved = await this.revertLocal(op, outcome);
      await db.rejectionToasts.put(rec);
      await db.outbox.delete(op.clientOpId);
      return preserved;
    });
    notifyRejection(rec);
    syncStateStore.setError(`Couldn't sync ${rec.humanName ?? op.entityClass} — ${rec.reason}`);
    if (op.fieldPath) {
      flashBus.emit({
        key: makeFlashKey(op.entityClass, op.entityId, op.fieldPath),
        reason: outcome.reason ?? 'sync failed',
      });
    } else if (op.command === 'create' && op.parentId) {
      flashBus.emit({
        key: makeFlashKey(op.entityClass, op.parentId, 'create'),
        reason: outcome.reason ?? 'sync failed',
      });
    }
    await appendSyncLog({
      direction: 'push',
      result: 'rolled_back',
      entityClass: op.entityClass,
      entityId: op.entityId,
      command: op.command,
      fieldPath: op.fieldPath,
      parentId: op.parentId,
      humanName: op.humanName,
      reason: rec.reason,
      ...(preserved
        ? {
            previousValue: snapshotValue(preserved.preservedValue),
            newValue: snapshotValue(preserved.preservedValue),
          }
        : rollbackSnapshot(op, outcome)),
      details: snapshotValue(outcome),
    });
    await db.outbox.delete(op.clientOpId);
  }

  private async recordRejection(
    op: OutboxEntry,
    outcome: OperationOutcome,
  ): Promise<RejectionRecord> {
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
      userId: this.currentUserId ?? undefined,
      entityClass: op.entityClass,
      entityId: op.entityId,
      parentId: op.parentId,
      fieldPath: op.fieldPath,
      humanName: op.humanName,
      reason: outcome.reason ?? 'sync failed',
      status: status as RejectionRecord['status'],
      createdAt: new Date().toISOString(),
    };
    await db.rejectionToasts.put(rec);
    return rec;
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
      db.characterSpells,
      db.characterLanguages,
      db.characterTechniques,
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
    for (const change of res.changes) {
      await appendSyncLog({
        direction: 'pull',
        result: 'synced',
        entityClass: change.entityClass,
        entityId: change.entityId,
        command: change.command,
        details: { revision: change.revision },
      });
    }
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
      case 'character_spell':
        await db.characterSpells.update(entityId, { revision });
        return;
      case 'character_language':
        await db.characterLanguages.update(entityId, { revision });
        return;
      case 'character_technique':
        await db.characterTechniques.update(entityId, { revision });
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
      case 'character_spell':
        await db.characterSpells.update(entityId, updates as Partial<LocalCharacterSpell>);
        return;
      case 'character_language':
        await db.characterLanguages.update(entityId, updates as Partial<LocalCharacterLanguage>);
        return;
      case 'character_technique':
        await db.characterTechniques.update(entityId, updates as Partial<LocalCharacterTechnique>);
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
      case 'character_spell':
        await db.characterSpells.delete(entityId);
        return;
      case 'character_language':
        await db.characterLanguages.delete(entityId);
        return;
      case 'character_technique':
        await db.characterTechniques.delete(entityId);
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

  private async discardSpeculativeCreate(op: OutboxEntry): Promise<void> {
    const db = getLocalDb();
    const relatedEntityIds = new Set([op.entityId]);
    if (op.entityClass === 'character_inventory') {
      let parents = [op.entityId];
      while (parents.length > 0) {
        const children = await db.characterInventory.where('parentId').anyOf(parents).toArray();
        parents = children.map((child) => child.id).filter((id) => !relatedEntityIds.has(id));
        for (const id of parents) relatedEntityIds.add(id);
      }
    }
    const candidateOps = await db.outbox
      .filter(
        (candidate) =>
          relatedEntityIds.has(candidate.entityId) ||
          (op.entityClass === 'character' && candidate.parentId === op.entityId),
      )
      .toArray();

    let speculativeInventoryIds: Set<string> | undefined;
    if (op.entityClass === 'character') {
      await db.characterTraits.where('characterId').equals(op.entityId).delete();
      await db.characterSkills.where('characterId').equals(op.entityId).delete();
      await db.characterSpells.where('characterId').equals(op.entityId).delete();
      await db.characterLanguages.where('characterId').equals(op.entityId).delete();
      await db.characterTechniques.where('characterId').equals(op.entityId).delete();
      await db.characterInventory.where('characterId').equals(op.entityId).delete();
      await db.characterCombat.delete(op.entityId);
    } else if (op.entityClass === 'character_inventory') {
      speculativeInventoryIds = new Set(
        candidateOps
          .filter((candidate) => candidate.command === 'create')
          .map((candidate) => candidate.entityId),
      );
      speculativeInventoryIds.add(op.entityId);

      for (const candidate of candidateOps) {
        if (
          !speculativeInventoryIds.has(candidate.entityId) &&
          candidate.command === 'patch' &&
          candidate.fieldPath === 'parentId'
        ) {
          await this.revertField(
            candidate.entityClass,
            candidate.entityId,
            candidate.fieldPath,
            candidate.prevValue,
          );
        }
      }
      await db.characterInventory.bulkDelete([...speculativeInventoryIds]);
    } else {
      await this.deleteLocal(op.entityClass, op.entityId);
    }
    if (op.entityClass === 'character') await this.deleteLocal(op.entityClass, op.entityId);
    const discardedOpIds = candidateOps
      .filter(
        (candidate) =>
          op.entityClass !== 'character_inventory' ||
          speculativeInventoryIds?.has(candidate.entityId) ||
          candidate.fieldPath === 'parentId' ||
          candidate.entityId === op.entityId,
      )
      .map((candidate) => candidate.clientOpId);
    await db.outbox.bulkDelete(discardedOpIds);
  }

  private async reinsertLocal(entityClass: EntityClass, prevValue: unknown): Promise<void> {
    if (!prevValue || typeof prevValue !== 'object') return;
    await this.applyServerRow(entityClass, prevValue as Record<string, unknown>, {
      ignoreOutboxConflict: true,
    });
  }

  /**
   * Write a server-shaped row into the appropriate Dexie store.  Skips
   * fields that have a pending/in_flight/transient_retry outbox op for
   * that (entityId, fieldPath) -- the local user intent always wins until
   * the server formally rejects it.  transient_retry ops are included
   * because they represent unconfirmed intent: the server may not have
   * applied them yet, and an immediate cursor pull must not silently
   * overwrite those fields with the pre-retry server value.
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
    // Campaign moves also change child links locally. Cursor rows must not
    // overwrite those side effects while the parent mutation is unconfirmed.
    if (!opts.ignoreOutboxConflict && typeof row.characterId === 'string') {
      const transfers = await db.outbox
        .where('entityId')
        .equals(row.characterId)
        .filter(
          (op) =>
            op.entityClass === 'character' &&
            op.fieldPath === 'campaignId' &&
            ['pending', 'in_flight', 'transient_retry'].includes(op.status),
        )
        .toArray();
      for (const op of transfers)
        for (const entry of op.localCampaignTransferUndo ?? []) {
          if (entry.entityId === id)
            for (const field of Object.keys(entry.after)) delete merged[field];
        }
    }
    if (!opts.ignoreOutboxConflict) {
      // `entityId` is indexed on the outbox (Dexie v3).  Do NOT wrap
      // this in a swallowing catch: if the query ever breaks again the
      // pull must fail loudly rather than silently clobbering pending
      // local edits (that exact bug shipped once — the index was
      // missing, Dexie threw SchemaError, and a `.catch(() => [])`
      // turned rule S4 into a no-op).
      const dirty = await db.outbox
        .where('entityId')
        .equals(id)
        .and(
          (o) =>
            o.entityClass === entityClass &&
            (o.status === 'pending' || o.status === 'in_flight' || o.status === 'transient_retry'),
        )
        .toArray();
      // A queued whole-entity delete has already removed the local row.
      // Do not let a bootstrap/from-zero cursor pull resurrect it before
      // the delete is acknowledged or rejected. Field-level protection
      // below is insufficient because delete operations have no fieldPath.
      if (dirty.some((op) => op.command === 'delete' && !op.fieldPath)) return;
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
        if ('libraryMechanics' in merged && merged.libraryMechanics !== null)
          merged.libraryMechanics = libraryMechanics.parse(merged.libraryMechanics);
        await db.characterTraits.put({ ...(existing ?? {}), ...merged } as LocalCharacterTrait);
        return;
      }
      case 'character_skill': {
        const existing = await db.characterSkills.get(id);
        if ('libraryMechanics' in merged && merged.libraryMechanics !== null)
          merged.libraryMechanics = libraryMechanics.parse(merged.libraryMechanics);
        await db.characterSkills.put({ ...(existing ?? {}), ...merged } as LocalCharacterSkill);
        return;
      }
      case 'character_spell': {
        const existing = await db.characterSpells.get(id);
        await db.characterSpells.put({ ...(existing ?? {}), ...merged } as LocalCharacterSpell);
        return;
      }
      case 'character_language': {
        const existing = await db.characterLanguages.get(id);
        await db.characterLanguages.put({
          ...(existing ?? {}),
          ...merged,
        } as LocalCharacterLanguage);
        return;
      }
      case 'character_technique': {
        const existing = await db.characterTechniques.get(id);
        await db.characterTechniques.put({
          ...(existing ?? {}),
          ...merged,
        } as LocalCharacterTechnique);
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
    // Auto-dismiss anything too old to be news and trim the table
    // before replaying, so bootstrap can't bury the user under months
    // of accumulated toasts.
    await pruneRejectionToasts();
    // Dexie's `.equals(undefined)` throws ("Keys must be of type string,
    // number, Date or Array"), so a where()/or() chain on `dismissedAt`
    // can't catch both the unset and explicit-empty-string states. Fall
    // back to a full-table filter — `rejectionToasts` is a small,
    // user-scoped set, so the cost is negligible.
    const viewerId = this.currentUserId;
    const open = await db.rejectionToasts
      .filter((r) => !r.dismissedAt)
      .toArray()
      .catch(() => [] as RejectionRecord[]);
    for (const r of open) {
      // Only this account's rejections. A session can end without a
      // purge (a refresh-token rejection just clears the tokens), so
      // signing in as someone else would otherwise surface the previous
      // account's toasts -- private skill/item labels included. Rows
      // with no userId predate the field and can't be attributed.
      if (r.userId === undefined || r.userId !== viewerId) continue;
      notifyRejection(r);
    }
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
  private async enforceMinimalViewLocally(): Promise<boolean> {
    const viewerId = this.currentUserId;
    if (!viewerId) return false;
    const db = getLocalDb();
    const [chars, camps] = await Promise.all([db.characters.toArray(), db.campaigns.toArray()]);
    const ids = characterIdsToMinimize({
      viewerId,
      characters: chars,
      campaigns: camps,
    });
    const restored = chars.filter(
      (character) => character.minimalViewMasked && !ids.has(character.id),
    );
    if (restored.length > 0) {
      await db.characters.bulkPut(
        restored.map((character) => ({ ...character, minimalViewMasked: false })),
      );
    }
    if (ids.size === 0) return restored.length > 0;
    const idArray = [...ids];
    // One transaction across the character row + every child table so
    // the purge is atomic — can't have skills present and the parent
    // row still carrying its real stats halfway through.
    //
    // The character-row rewrite is the **client half** of the share
    // gate (docs/specs/campaign-content-sharing.md). The server's
    // `projectCharacterRow` ships identity-only fields for minimal
    // rows, but `applyServerRow` is merge-into-existing — without this
    // rewrite the local row retains whatever `st` / `hpMod` /
    // `tempEffects` etc. were synced BEFORE the share flip (a share
    // flip bumps the campaign row's revision, not the character row's,
    // so the cursor doesn't repull the masked projection). The client
    // would then derive real HP/FP/derived from those stale caches and
    // — if the local campaign row hasn't resolved yet (or the viewer
    // isn't a campaign member at all, e.g. a stale-IndexedDB account)
    // — `useCharacterAccessLocal.isMinimal` returns false and the full
    // sheet renders with the leaked real values.
    await db.transaction(
      'rw',
      [
        db.characters,
        db.characterTraits,
        db.characterSkills,
        db.characterSpells,
        db.characterLanguages,
        db.characterTechniques,
        db.characterInventory,
        db.characterCombat,
      ],
      async () => {
        await db.characterTraits.where('characterId').anyOf(idArray).delete();
        await db.characterSkills.where('characterId').anyOf(idArray).delete();
        await db.characterSpells.where('characterId').anyOf(idArray).delete();
        await db.characterLanguages.where('characterId').anyOf(idArray).delete();
        await db.characterTechniques.where('characterId').anyOf(idArray).delete();
        await db.characterInventory.where('characterId').anyOf(idArray).delete();
        // Combat's primary key IS the characterId (1:1), so a straight
        // bulkDelete by pk works.  (`where('id')` is wrong here — `id`
        // isn't indexed on this store, and the resulting SchemaError
        // used to abort the sweep and wedge the pull in 'error'.)
        await db.characterCombat.bulkDelete(idArray);
        // Rewrite each minimal character's row down to identity-only
        // fields, mirroring `projectCharacterRow` on the server. The
        // identity columns (id / ownerId / campaignId / name / height /
        // weight / age / birthdate / appearance / timestamps / revision) are
        // preserved; every private column is reset to its schema
        // default so derived stats and the combat tab can't recover
        // the masked character's real state. Tech level is no longer a
        // character column — it's read from the (unmasked) campaign row.
        const now = new Date().toISOString();
        for (const id of idArray) {
          const existing = await db.characters.get(id);
          if (!existing) continue;
          await db.characters.put({
            ...existing,
            st: 10,
            dx: 10,
            iq: 10,
            ht: 10,
            hpMod: 0,
            willMod: 0,
            perMod: 0,
            fpMod: 0,
            speedQuarterMod: 0,
            moveMod: 0,
            tempEffects: [],
            dismissedWarnings: [],
            activeConditionGroups: [],
            updatedAt: now,
            minimalViewMasked: true,
          });
        }
      },
    );
    // Same reasoning as the row rewrite above: the sync journal is
    // another surface carrying character data, so a share=false flip
    // has to reach it too or the masked character's real values stay
    // readable in the sync dialog and the debug dump.
    await rememberRevokedCharacters(idArray);
    await redactSyncLogForCharacters(idArray);
    return restored.length > 0;
  }

  /**
   * Prune local characters/campaigns the viewer has completely lost
   * access to (removed from a campaign, campaign deleted, character
   * moved out of a shared campaign) using the authoritative `accessible`
   * set the cursor response carries on every page (see
   * `src/server/routes/sync.ts`).  The server simply stops emitting
   * these rows as upserts once access is gone, and tombstones can't
   * help either -- they're scoped to campaigns the viewer *currently*
   * belongs to, so an ex-member never sees the delete.  Without this
   * sweep the stale rows (and their child rows) live in IndexedDB
   * forever.
   *
   * Never prunes:
   *   - rows with `revision < 0` (speculative local create not yet
   *     acked -- AGENTS.md rule S7),
   *   - any entity with an outstanding outbox op (pending/in_flight/
   *     transient_retry) -- queued intent the server doesn't know
   *     about yet.
   *
   * No-op when `accessible` is absent (older server that doesn't send
   * the field yet).
   */
  private async pruneInaccessibleLocally(
    accessible: SyncCursorResponse['accessible'],
  ): Promise<void> {
    if (!accessible) return;
    const db = getLocalDb();
    const accessibleCharacterIds = new Set(accessible.characterIds);
    const accessibleCampaignIds = new Set(accessible.campaignIds);

    const [chars, camps] = await Promise.all([db.characters.toArray(), db.campaigns.toArray()]);

    // Clear the revoked mark first, and unconditionally: a character
    // whose access came back must recover even when nothing else is
    // stale (the early return below would otherwise skip it forever).
    const regained = chars.filter((c) => c.accessRevoked && accessibleCharacterIds.has(c.id));
    if (regained.length > 0) {
      // Marker only -- never rewrite the whole row from a snapshot that
      // may already be stale.
      await db.characters.bulkUpdate(
        regained.map((c) => ({ key: c.id, changes: { accessRevoked: false } })),
      );
    }

    const staleCharacterIds = chars
      .filter((c) => !accessibleCharacterIds.has(c.id) && c.revision >= 0)
      .map((c) => c.id);
    const staleCampaignIds = camps
      .filter((c) => !accessibleCampaignIds.has(c.id) && c.revision >= 0)
      .map((c) => c.id);

    if (staleCharacterIds.length === 0 && staleCampaignIds.length === 0) return;

    // Never prune an entity with unsent/unsettled local intent -- a
    // queued create/patch/delete means the server doesn't know about it
    // yet, or the user has an edit in flight.
    const candidateIds = [...staleCharacterIds, ...staleCampaignIds];
    const dirtyOps = await db.outbox
      .where('entityId')
      .anyOf(candidateIds)
      .filter(
        (o) => o.status === 'pending' || o.status === 'in_flight' || o.status === 'transient_retry',
      )
      .toArray();
    const dirtyEntityIds = new Set(dirtyOps.map((o) => o.entityId));

    const charIdsToDelete = staleCharacterIds.filter((id) => !dirtyEntityIds.has(id));
    const campaignIdsToDelete = staleCampaignIds.filter((id) => !dirtyEntityIds.has(id));

    // A character we deliberately KEEP (its op still has to be
    // delivered) would otherwise look present-and-unmasked, i.e. fully
    // accessible, to the share gate. Mark it so the dialog and the
    // debug dump can tell the difference; clear the mark for any
    // character whose access came back.
    //
    // Update ONLY the marker: `chars` was read before the awaited
    // outbox query above, so a full-row bulkPut would write that stale
    // snapshot back over any field another tab committed in between --
    // a silent, visible rollback of a value whose op is still pending.
    const retained = new Set(staleCharacterIds.filter((id) => dirtyEntityIds.has(id)));
    const newlyRevoked = chars.filter((c) => retained.has(c.id) && !c.accessRevoked);
    if (newlyRevoked.length > 0) {
      await db.characters.bulkUpdate(
        newlyRevoked.map((c) => ({ key: c.id, changes: { accessRevoked: true } })),
      );
    }

    if (charIdsToDelete.length === 0 && campaignIdsToDelete.length === 0) return;

    // Single transaction across every affected store so observers see
    // one atomic update.
    await db.transaction(
      'rw',
      [
        db.characters,
        db.characterTraits,
        db.characterSkills,
        db.characterSpells,
        db.characterLanguages,
        db.characterTechniques,
        db.characterInventory,
        db.characterCombat,
        db.campaigns,
      ],
      async () => {
        if (charIdsToDelete.length > 0) {
          await db.characterTraits.where('characterId').anyOf(charIdsToDelete).delete();
          await db.characterSkills.where('characterId').anyOf(charIdsToDelete).delete();
          await db.characterSpells.where('characterId').anyOf(charIdsToDelete).delete();
          await db.characterLanguages.where('characterId').anyOf(charIdsToDelete).delete();
          await db.characterTechniques.where('characterId').anyOf(charIdsToDelete).delete();
          await db.characterInventory.where('characterId').anyOf(charIdsToDelete).delete();
          // Combat's primary key IS the characterId -- bulkDelete by pk,
          // not `where('id')` (unindexed, throws SchemaError).
          await db.characterCombat.bulkDelete(charIdsToDelete);
          await db.characters.bulkDelete(charIdsToDelete);
        }
        if (campaignIdsToDelete.length > 0) {
          await db.campaigns.bulkDelete(campaignIdsToDelete);
        }
      },
    );
    // Record the revocation BEFORE the best-effort redaction: the rows
    // are already gone, so if that redaction fails this ledger is the
    // only thing left that can keep those records closed.
    await rememberRevokedCharacters(charIdsToDelete);
    // The journal holds before/after character values too; deleting the
    // rows while leaving those readable in the sync dialog and the
    // debug dump would defeat the purge.
    await redactSyncLogForCharacters(charIdsToDelete);
  }

  private fireCycleDone(): void {
    for (const cb of this.cycleListeners) cb();
  }

  private refreshIndicator(pending: number): void {
    // An outstanding cycle failure outlives ANY outbox state. This runs
    // from the outbox liveQuery, so without the guard the delete that
    // settles a successful upload would flip the badge to 'synced', and
    // a fresh edit made *during* the outage would flip it to 'syncing'
    // -- either way dropping the reason and its banner without a single
    // successful cycle.
    if (!this.syncHealthy) return;
    syncStateStore.set(pending > 0 ? 'syncing' : 'synced');
  }

  /** A cycle failed; the badge must not go green until one succeeds. */
  private markCycleFailed(): void {
    this.syncHealthy = false;
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
    batchId: op.batchId,
    createdAt: op.enqueuedAt,
  };
}

/**
 * Before/after for a rollback, in the direction the local row actually
 * moved: from the refused `attemptedValue` back to whatever
 * `revertLocal` restored.  That is `prevValue` normally, but the
 * server's `latestEntity` when it returned one (conflict / stale_base),
 * since `revertLocal` prefers it as the more recent truth.
 */
function rollbackSnapshot(
  op: OutboxEntry,
  outcome: OperationOutcome,
): { previousValue: unknown; newValue: unknown } {
  let restored = op.prevValue;
  if (outcome.latestEntity && typeof outcome.latestEntity === 'object' && op.fieldPath) {
    restored = (outcome.latestEntity as Record<string, unknown>)[op.fieldPath];
  }
  return {
    previousValue: snapshotValue(op.attemptedValue),
    newValue: snapshotValue(restored),
  };
}

/**
 * Errors already turned into a journal entry + indicator reason.  The
 * cursor-pull path reports and then rethrows, so `runLoop`'s catch sees
 * the same object again; without this it would log the failure twice.
 */
const reportedFailures = new WeakSet<object>();

/**
 * The single way a whole-cycle failure becomes visible: one journal
 * entry plus a named indicator error.  Every `catch` that ends a sync
 * cycle must go through here — a bare `syncStateStore.set('error')`
 * produces a red badge with nothing behind it.
 */
async function reportCycleFailure(
  err: unknown,
  prefix: string,
  direction: 'push' | 'pull' | 'local' = 'local',
  extraDetails?: Record<string, unknown>,
): Promise<void> {
  if (typeof err === 'object' && err !== null) {
    if (reportedFailures.has(err)) return;
    reportedFailures.add(err);
  }
  const reason = failureReason(err, prefix);
  await appendSyncLog({
    direction,
    result: 'failed',
    reason,
    // Capped like every other payload: `errorDetails` embeds the whole
    // `ApiError.body`, and a server returning a large non-2xx body on
    // every retry would otherwise fill the journal with copies of it.
    details: snapshotValue({ ...extraDetails, error: errorDetails(err) }),
  });
  syncStateStore.setError(reason);
}

/**
 * A short, user-facing sentence for a whole-cycle failure.  HTTP status
 * is included because "HTTP 530" is the difference between "my server
 * is down" and "my edit was rejected" -- and the user is the one who
 * has to tell those apart when the badge goes red.
 */
function failureReason(err: unknown, prefix: string): string {
  if (err instanceof ApiError) {
    const detail = err.message === `HTTP ${err.status}` ? '' : ` — ${err.message}`;
    return `${prefix} (HTTP ${err.status})${detail}`;
  }
  if (err instanceof Error) return `${prefix} — ${err.message}`;
  return prefix;
}

function errorDetails(err: unknown): unknown {
  if (err instanceof ApiError) {
    return { name: err.name, message: err.message, status: err.status, body: err.body };
  }
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
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
  // The gate may have set the user before this landed; flush any
  // replay that was waiting for somewhere to send toasts.
  if (notifier) void getSyncOrchestrator().flushPendingRejectionReplay();
}

function hasRejectionNotifier(): boolean {
  return activeNotifier !== null;
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
