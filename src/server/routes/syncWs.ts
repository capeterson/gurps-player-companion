/**
 * WebSocket sync push channel.
 *
 * Endpoint: GET /api/v1/sync/ws?token=<JWT or API key>
 *
 * The browser WebSocket API can't set Authorization headers, so the
 * client passes the access token as a query parameter.  We resolve it
 * with the same code path as the HTTP middleware, then keep the
 * socket open and register it with `wsBus.subscribe`.  Sync dispatch
 * fans out invalidation pings via `wsBus.publish` on every applied
 * mutation; the client uses those to wake the orchestrator's
 * /sync/cursor pull instead of waiting for the periodic 30s timer.
 *
 * **Correctness invariant:** WS messages are an *acceleration*, not
 * a source of truth.  The server never sends row data over the WS;
 * the client always reconciles via the HTTP cursor + outbox.  See
 * AGENTS.md → Architecture invariants.
 */

import type { Context } from 'hono';
import { resolveAuthHeader } from '../auth/session.ts';
import { type WsBroadcast, subscribe } from '../services/wsBus.ts';

// The hono/bun `upgradeWebSocket` returns a middleware that this
// handler immediately invokes; we keep the type loose so we can pass
// either the real helper or a test fake.
// biome-ignore lint/suspicious/noExplicitAny: cross-adapter shape
type UpgradeFn = (handler: (c: Context) => WsHandler) => any;

interface WsHandler {
  onOpen?: (event: unknown, ws: WsConn) => void | Promise<void>;
  onMessage?: (event: { data: string | ArrayBuffer }, ws: WsConn) => void | Promise<void>;
  onClose?: (event: unknown, ws: WsConn) => void | Promise<void>;
  onError?: (event: unknown, ws: WsConn) => void | Promise<void>;
}

interface WsConn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState?: number;
}

/**
 * Build the Hono handler for `/sync/ws`.  Accepts an `upgradeWebSocket`
 * factory so the same logic can be reused with bun / deno / cloudflare
 * adapters.  In Bun production we wire `hono/bun`'s helper; in tests
 * we can pass a fake.
 */
export function createSyncWsHandler(
  upgradeWebSocket: UpgradeFn,
): (c: Context) => Promise<Response> {
  return async (c) => {
    const url = new URL(c.req.url);
    const token = url.searchParams.get('token');
    if (!token) {
      return c.json({ error: 'missing token' }, 401);
    }
    let user: Awaited<ReturnType<typeof resolveAuthHeader>>;
    try {
      user = await resolveAuthHeader(`Bearer ${token}`);
    } catch {
      return c.json({ error: 'invalid token' }, 401);
    }
    if (!user) return c.json({ error: 'invalid token' }, 401);
    if (user.suspendedAt) return c.json({ error: 'suspended' }, 403);

    const userId = user.id;
    const middleware = upgradeWebSocket(() => {
      let unsubscribe: (() => void) | null = null;
      return {
        onOpen(_event: unknown, ws: WsConn) {
          unsubscribe = subscribe(userId, ws);
          ws.send(JSON.stringify({ kind: 'hello', emittedAt: new Date().toISOString() }));
        },
        onClose() {
          unsubscribe?.();
          unsubscribe = null;
        },
        onError() {
          unsubscribe?.();
          unsubscribe = null;
        },
        onMessage(event: { data: string | ArrayBuffer }, ws: WsConn) {
          const data = typeof event.data === 'string' ? event.data : '';
          if (data === 'ping') {
            ws.send('pong');
          }
        },
      } as WsHandler;
    });
    // The upgradeWebSocket helper returns a Hono middleware (c, next) =>
    // Promise<Response>.  Invoke it directly with a no-op next; the
    // helper returns the Response on its own.
    return await middleware(c, async () => {});
  };
}

export type { WsBroadcast };
