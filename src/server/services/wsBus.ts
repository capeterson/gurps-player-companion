/**
 * In-process pub/sub for WebSocket fan-out.
 *
 * `publish(userId, message)` delivers to every WebSocket the user has
 * open across browser tabs.  Used by `syncDispatch` to nudge a user's
 * other devices that the server has new revisions waiting on
 * /sync/cursor.
 *
 * Single-process by design — multi-process deployment would require
 * a Redis (or similar) backplane.  The README documents this.
 */

export interface WsBroadcast {
  /** Tagged union for forward compatibility. */
  readonly kind: 'sync_invalidate' | 'encounter_invalidate';
  readonly entityClasses?: readonly string[];
  /** Present only for the online-only encounter tracker invalidation. */
  readonly campaignId?: string;
  readonly encounterId?: string;
  /** Server timestamp for client-side debug / dedup. */
  readonly emittedAt: string;
}

interface WsLike {
  send(text: string): void;
  /** Non-standard but Bun's WebSocket has this. */
  readyState?: number;
}

const subscribers = new Map<string, Set<WsLike>>();

export function subscribe(userId: string, ws: WsLike): () => void {
  let bucket = subscribers.get(userId);
  if (!bucket) {
    bucket = new Set();
    subscribers.set(userId, bucket);
  }
  bucket.add(ws);
  return () => {
    const b = subscribers.get(userId);
    if (!b) return;
    b.delete(ws);
    if (b.size === 0) subscribers.delete(userId);
  };
}

export function publish(userId: string, message: WsBroadcast): void {
  const bucket = subscribers.get(userId);
  if (!bucket || bucket.size === 0) return;
  const text = JSON.stringify(message);
  for (const ws of bucket) {
    if (ws.readyState !== undefined && ws.readyState !== 1) continue;
    try {
      ws.send(text);
    } catch {
      // Drop silently — a closed socket will be cleaned up on its
      // own close handler.
    }
  }
}

/** Test/diagnostic helper. */
export function subscriberCount(userId: string): number {
  return subscribers.get(userId)?.size ?? 0;
}

/** Test helper: clear all subscriptions (e.g. between integration tests). */
export function _resetForTests(): void {
  subscribers.clear();
}
