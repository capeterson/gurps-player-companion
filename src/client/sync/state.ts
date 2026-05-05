/**
 * Sync indicator state machine.
 *
 * Three visible states:
 *   - 'syncing'  the orchestrator is draining or pulling, OR there are
 *                pending outbox rows even when offline.
 *   - 'error'    a sync attempt failed (transient over max attempts,
 *                or rejected/conflict that surfaced a persistent toast).
 *   - 'synced'   no pending ops, no errors, last cycle succeeded.
 *
 * Per the issue: every transient state must be visible for at least
 * one second so a user can perceive feedback even when the underlying
 * sync resolves before the next repaint.  The min-dwell logic lives
 * inside this store so every consumer sees an identical, debounced
 * state -- the indicator component never has to do its own debouncing.
 *
 * `error` overrides any pending dwell so failures appear immediately.
 */

export type SyncIndicatorState = 'syncing' | 'error' | 'synced';

const MIN_DWELL_MS = 1000;

type Listener = (s: SyncIndicatorState) => void;

export class SyncStateStore {
  private current: SyncIndicatorState;
  private subs = new Set<Listener>();
  private lastTransitionAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTarget: SyncIndicatorState | null = null;
  private now: () => number;

  constructor(initial: SyncIndicatorState = 'synced', now: () => number = Date.now) {
    this.current = initial;
    this.now = now;
    this.lastTransitionAt = now();
  }

  get value(): SyncIndicatorState {
    return this.current;
  }

  set(target: SyncIndicatorState): void {
    if (target === this.current && this.pendingTarget === null) return;

    // Errors short-circuit any pending min-dwell -- failures must be
    // visible right away, even if it cuts a "syncing" frame short.
    if (target === 'error') {
      this.clearPending();
      this.commit('error');
      return;
    }

    const elapsed = this.now() - this.lastTransitionAt;
    if (elapsed >= MIN_DWELL_MS) {
      this.clearPending();
      this.commit(target);
      return;
    }

    // Wait out the rest of the dwell window before applying the new
    // value.  If another set() lands during the wait, it overwrites
    // `pendingTarget` so the freshest intent wins (still subject to
    // the same dwell budget started by the *previous* transition).
    this.pendingTarget = target;
    if (this.pendingTimer) return;
    this.pendingTimer = setTimeout(() => {
      const next = this.pendingTarget ?? this.current;
      this.pendingTimer = null;
      this.pendingTarget = null;
      this.commit(next);
    }, MIN_DWELL_MS - elapsed);
  }

  subscribe(cb: Listener): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** Test helper -- discard any pending dwell timer. */
  reset(target: SyncIndicatorState = 'synced'): void {
    this.clearPending();
    this.current = target;
    this.lastTransitionAt = this.now();
    for (const cb of this.subs) cb(this.current);
  }

  private clearPending(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingTarget = null;
  }

  private commit(value: SyncIndicatorState): void {
    if (value === this.current) return;
    this.current = value;
    this.lastTransitionAt = this.now();
    for (const cb of this.subs) cb(this.current);
  }
}

/** Singleton consumed by `useSyncIndicatorState`. */
export const syncStateStore = new SyncStateStore();
