/**
 * Client-side WebSocket subscriber.
 *
 * Connects to `/api/v1/sync/ws?token=<accessToken>` after auth, and
 * calls `getSyncOrchestrator().triggerDrain()` whenever the server
 * pushes a `sync_invalidate` message.  WS frames carry no row data;
 * they are an *acceleration* of the periodic /sync/cursor pull.
 *
 * Lifecycle:
 *   - `start()` opens the socket using the current access token.
 *   - On close (network drop, token rotation), we exponentially back
 *     off (max 30s) and reconnect.  When `tokenStore` is empty (user
 *     logged out) we stop reconnecting until `start()` is called again.
 *   - `stop()` closes any open socket and cancels pending reconnects.
 *
 * This module is page-only — never imported by the server.
 */

import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator } from './orchestrator.ts';

interface WsMessage {
  kind: 'hello' | 'sync_invalidate';
  emittedAt?: string;
  entityClasses?: string[];
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
// Cap reconnect attempts that never reach `open` (e.g. a dev server
// that doesn't proxy WS upgrades, or a permanently misconfigured edge
// proxy in prod). Without this, the client logs a fresh handshake
// failure every backoff tick. The orchestrator's periodic /sync/cursor
// pull keeps state fresh without WS push.
const MAX_HANDSHAKE_FAILURES = 4;

class SyncWsSubscriber {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private handshakeFailures = 0;
  private running = false;
  private gaveUp = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    // Re-arm after a previous give-up: a fresh `start()` (e.g. login,
    // token refresh) means the caller wants us to try again.
    this.gaveUp = false;
    this.handshakeFailures = 0;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore — already closing
      }
      this.socket = null;
    }
  }

  private connect(): void {
    if (!this.running) return;
    if (this.gaveUp) return;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    const tokens = tokenStore.read();
    if (!tokens) {
      // No auth — don't bother connecting; caller will re-start after login.
      this.stop();
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/v1/sync/ws?token=${encodeURIComponent(
      tokens.accessToken,
    )}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.handshakeFailures += 1;
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    let opened = false;

    socket.addEventListener('open', () => {
      opened = true;
      this.attempts = 0;
      this.handshakeFailures = 0;
      // Server-driven invalidation only — but we ping periodically so
      // load balancers / proxies don't idle-close the channel.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        try {
          if (socket.readyState === 1) socket.send('ping');
        } catch {
          // ignore — onclose will fire
        }
      }, PING_INTERVAL_MS);
    });

    socket.addEventListener('message', (event) => {
      let parsed: WsMessage | null = null;
      try {
        if (typeof event.data === 'string') {
          if (event.data === 'pong') return;
          parsed = JSON.parse(event.data) as WsMessage;
        }
      } catch {
        return;
      }
      if (!parsed) return;
      if (parsed.kind === 'sync_invalidate') {
        getSyncOrchestrator().triggerDrain();
      }
    });

    socket.addEventListener('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
      // A close before `open` means the handshake never succeeded —
      // commonly the dev server (no WS upgrade support) or a misconfigured
      // proxy. After a few of those in a row, stop spamming reconnects;
      // periodic /sync/cursor pulls remain in effect.
      if (!opened) {
        this.handshakeFailures += 1;
        if (this.handshakeFailures >= MAX_HANDSHAKE_FAILURES) {
          this.gaveUp = true;
          return;
        }
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // `close` fires after `error`; we let the close handler schedule
      // the reconnect.  Don't double-schedule here.
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) return;
    this.attempts += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (this.attempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

let singleton: SyncWsSubscriber | null = null;

export function getSyncWsSubscriber(): SyncWsSubscriber {
  if (!singleton) singleton = new SyncWsSubscriber();
  return singleton;
}

export function resetSyncWsSubscriberForTests(): void {
  if (singleton) singleton.stop();
  singleton = null;
}
