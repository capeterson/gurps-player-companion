import { websocketConnections, websocketDeliveryFailures } from '../telemetry.ts';
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
  /** Scopes encounter or library query invalidation; never contains row data. */
  readonly campaignId?: string;
  readonly encounterId?: string;
  /** Server timestamp for client-side debug / dedup. */
  readonly emittedAt: string;
}

interface WsLike {
  send(text: string): void;
  /** Non-standard but Bun's WebSocket has this. */
  readyState?: number;
  close?(code?: number, reason?: string): void;
}

const subscribers = new Map<string, Set<WsLike>>();

export function subscribe(userId: string, ws: WsLike): () => void {
  let bucket = subscribers.get(userId);
  if (!bucket) {
    bucket = new Set();
    subscribers.set(userId, bucket);
  }
  const isNew = !bucket.has(ws);
  bucket.add(ws);
  if (isNew) websocketConnections.add(1);
  return () => {
    const b = subscribers.get(userId);
    if (!b) return;
    if (b.delete(ws)) websocketConnections.add(-1);
    if (b.size === 0) subscribers.delete(userId);
  };
}

export function publish(userId: string, message: WsBroadcast): void {
  afterDbCommit(() => deliver(userId, message));
}

function deliver(userId: string, message: WsBroadcast): void {
  const bucket = subscribers.get(userId);
  if (!bucket || bucket.size === 0) return;
  const text = JSON.stringify(message);
  for (const ws of bucket) {
    if (ws.readyState !== undefined && ws.readyState !== 1) continue;
    try {
      ws.send(text);
    } catch {
      websocketDeliveryFailures.add(1);
      // A closed socket will be cleaned up on its
      // own close handler.
    }
  }
}

/**
 * Close every subscribed socket (graceful shutdown). 1012 "service restart"
 * tells clients to reconnect, which lands them on the replacement process;
 * their HTTP cursor pull covers anything published in between.
 */
export function closeAll(code = 1012, reason = 'server restarting'): number {
  let closed = 0;
  for (const bucket of subscribers.values()) {
    for (const ws of bucket) {
      try {
        ws.close?.(code, reason);
        closed += 1;
      } catch {
        // Already closed.
      }
    }
  }
  const active = [...subscribers.values()].reduce((sum, bucket) => sum + bucket.size, 0);
  websocketConnections.add(-active);
  subscribers.clear();
  return closed;
}

/** Test/diagnostic helper. */
export function subscriberCount(userId: string): number {
  return subscribers.get(userId)?.size ?? 0;
}

/** Test helper: clear all subscriptions (e.g. between integration tests). */
export function _resetForTests(): void {
  const active = [...subscribers.values()].reduce((sum, bucket) => sum + bucket.size, 0);
  websocketConnections.add(-active);
  subscribers.clear();
}
import { afterDbCommit } from '../db/client.ts';
