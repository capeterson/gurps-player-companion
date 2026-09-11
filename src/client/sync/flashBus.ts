/**
 * Cross-component event bus for async rollback flashes.
 *
 * The problem: `useDraftField`'s `onSave` resolves immediately when an
 * outbox enqueue commits to Dexie.  The actual server rejection
 * happens later (after the orchestrator drains the outbox).  By then
 * the hook's local promise has already settled successfully, so the
 * built-in flashRollback never fires.
 *
 * The flash bus closes that loop: the orchestrator emits a
 * `{ key, reason }` event keyed by `${entityClass}:${entityId}:${fieldPath}`,
 * and `useDraftField` consumers subscribe to their own key so they can
 * revert to `lastCommittedRef` and trigger the field-rollback animation
 * (AGENTS.md rule 2).
 */

export interface FlashEvent {
  key: string;
  reason: string;
  /** Animate a local gesture failure without reverting another input’s draft. */
  visualOnly?: boolean;
}

type Listener = (e: FlashEvent) => void;

export class FlashBus {
  private subs = new Map<string, Set<Listener>>();
  private prefixSubs = new Map<string, Set<Listener>>();

  emit(event: FlashEvent): void {
    const set = this.subs.get(event.key);
    if (set) {
      for (const cb of set) cb(event);
    }
    // Prefix subscriptions: list rows that want any field of a given
    // entity to flash them subscribe with `${entityClass}:${id}:`. Match
    // by prefix so one row subscription covers every fieldPath.
    for (const [prefix, listeners] of this.prefixSubs) {
      if (!event.key.startsWith(prefix)) continue;
      for (const cb of listeners) cb(event);
    }
  }

  subscribe(key: string, cb: Listener): () => void {
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(cb);
    return () => {
      const s = this.subs.get(key);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.subs.delete(key);
    };
  }

  /**
   * Subscribe to every event whose key starts with `prefix` (e.g.
   * `character_inventory:${id}:` for row-level rollback flashes across
   * all of an item's field paths). Returns an unsubscribe function.
   */
  subscribePrefix(prefix: string, cb: Listener): () => void {
    let set = this.prefixSubs.get(prefix);
    if (!set) {
      set = new Set();
      this.prefixSubs.set(prefix, set);
    }
    set.add(cb);
    return () => {
      const s = this.prefixSubs.get(prefix);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.prefixSubs.delete(prefix);
    };
  }
}

export const flashBus = new FlashBus();

/** Build a stable flash key shared between the producer and the input. */
export function makeFlashKey(entityClass: string, entityId: string, fieldPath: string): string {
  return `${entityClass}:${entityId}:${fieldPath}`;
}
