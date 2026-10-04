/**
 * WebSocket invalidations accelerate the normal HTTP sync cycle. Diagnostics
 * describe this page's socket independently of the HTTP sync indicator.
 */
import { getLocalDb } from '../db/dexie.ts';
import { connectionStore } from '../lib/connectionState.ts';
import { invalidateEncounter } from '../features/encounters/encounterInvalidation.ts';
import { readUserIdFromToken, tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator } from './orchestrator.ts';

interface WsMessage {
  kind: 'hello' | 'sync_invalidate' | 'encounter_invalidate';
  emittedAt?: string;
  entityClasses?: string[];
  campaignId?: string;
  encounterId?: string;
}

export interface SyncWsStatus {
  readonly state: 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'offline';
  readonly lastConnectedAt: string | null;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
// Some proxies leave the upgrade pending without ever emitting open/close.
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_HANDSHAKE_FAILURES = 4;
const HANDSHAKE_COOLDOWN_MS = 5 * 60_000;

/** Account-scoped diagnostic metadata; logout purges the entire syncMeta store. */
export function syncWsLastConnectedKey(userId: string): string {
  return `syncWsLastConnected:${userId}`;
}

class SyncWsSubscriber {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private handshakeFailures = 0;
  private running = false;
  private sessionId: string | null = null;
  private userId: string | null = null;
  private accessToken: string | null = null;
  private generation = 0;
  private unsubscribeTokens: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SyncWsStatus = { state: 'stopped', lastConnectedAt: null };

  get status(): SyncWsStatus {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(
    state: SyncWsStatus['state'],
    lastConnectedAt = this.snapshot.lastConnectedAt,
  ): void {
    if (state === this.snapshot.state && lastConnectedAt === this.snapshot.lastConnectedAt) return;
    this.snapshot = { state, lastConnectedAt };
    for (const listener of this.listeners) listener();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribeTokens = tokenStore.subscribe(this.refreshSession);
    this.unsubscribeConnection = connectionStore.subscribe(() => {
      if (connectionStore.status.online) this.onOnline();
      else this.onOffline();
    });
    this.refreshSession();
  }

  stop(): void {
    this.running = false;
    this.unsubscribeTokens?.();
    this.unsubscribeTokens = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.disconnect();
    this.sessionId = null;
    this.userId = null;
    this.accessToken = null;
    this.publish('stopped', null);
  }

  private refreshSession = (): void => {
    if (!this.running) return;
    const tokens = tokenStore.read();
    if (tokens?.sessionId === this.sessionId && tokens?.accessToken === this.accessToken) return;
    const changedSession = (tokens?.sessionId ?? null) !== this.sessionId;
    this.disconnect();
    this.sessionId = tokens?.sessionId ?? null;
    this.userId = readUserIdFromToken();
    this.accessToken = tokens?.accessToken ?? null;
    this.handshakeFailures = 0;
    this.attempts = 0;
    if (changedSession || !tokens) this.publish('stopped', null);
    if (!tokens) return;
    if (changedSession) void this.restoreLastConnected();
    this.connect();
  };

  private onOnline = (): void => {
    if (!this.running || !this.sessionId || this.socket) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connect();
  };

  private onOffline = (): void => {
    if (!this.running || !this.sessionId) return;
    this.disconnect();
    this.publish('offline');
  };

  /** Invalidate handlers before close(), whose event can arrive after a restart. */
  private disconnect(): void {
    this.generation++;
    this.clearHandshakeTimeout();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // The socket may already be closing.
    }
  }

  private clearHandshakeTimeout(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private async restoreLastConnected(): Promise<void> {
    const sessionId = this.sessionId;
    const userId = this.userId;
    if (!userId) return;
    try {
      const row = await getLocalDb().syncMeta.get(syncWsLastConnectedKey(userId));
      if (!this.running || this.sessionId !== sessionId || this.userId !== userId) return;
      if (
        typeof row?.value === 'string' &&
        Number.isFinite(Date.parse(row.value)) &&
        (!this.snapshot.lastConnectedAt || row.value > this.snapshot.lastConnectedAt)
      ) {
        this.publish(this.snapshot.state, row.value);
      }
    } catch {
      // Diagnostics must never prevent connecting.
    }
  }

  private async persistLastConnected(at: string): Promise<void> {
    const sessionId = this.sessionId;
    const userId = this.userId;
    if (!userId) return;
    try {
      const db = getLocalDb();
      await db.transaction('rw', db.syncMeta, async () => {
        // Check inside the transaction so a queued write cannot recreate
        // account metadata after logout's purge transaction has completed.
        if (!this.running || tokenStore.read()?.sessionId !== sessionId || this.userId !== userId)
          return;
        const key = syncWsLastConnectedKey(userId);
        const previous = await db.syncMeta.get(key);
        if (tokenStore.read()?.sessionId !== sessionId) return;
        if (typeof previous?.value === 'string' && previous.value >= at) return;
        await db.syncMeta.put({ key, value: at });
      });
    } catch {
      // The live timestamp remains useful if device storage is unavailable.
    }
  }

  private connect(): void {
    if (!this.running || !this.sessionId) return;
    if (!connectionStore.canAttemptNetwork() || !connectionStore.status.online) {
      this.publish('offline');
      return;
    }
    if (typeof WebSocket === 'undefined') {
      this.publish('stopped');
      return;
    }
    const tokens = tokenStore.read();
    if (!tokens || tokens.sessionId !== this.sessionId) {
      this.refreshSession();
      return;
    }
    this.publish(
      this.attempts > 0 || this.snapshot.lastConnectedAt ? 'reconnecting' : 'connecting',
    );
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/api/v1/sync/ws?token=${encodeURIComponent(tokens.accessToken)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.handshakeFailed();
      return;
    }
    this.socket = socket;
    const generation = this.generation;
    const current = () => this.running && this.generation === generation && this.socket === socket;
    let opened = false;
    this.handshakeTimer = setTimeout(() => {
      if (!current()) return;
      this.handshakeTimer = null;
      // Invalidate before close(): a late close/open must not count the same
      // failure twice or clear a later connection's timers and timestamp.
      this.socket = null;
      try {
        socket.close();
      } catch {
        // A pending upgrade may already have been abandoned by the browser.
      }
      this.handshakeFailed();
    }, HANDSHAKE_TIMEOUT_MS);

    socket.addEventListener('open', () => {
      if (!current()) return;
      this.clearHandshakeTimeout();
      opened = true;
      this.attempts = 0;
      this.handshakeFailures = 0;
      const at = new Date().toISOString();
      this.publish('connected', at);
      void this.persistLastConnected(at);
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (!current()) return;
        try {
          if (socket.readyState === 1) socket.send('ping');
        } catch {
          // close/error handlers will handle a failed connection.
        }
      }, PING_INTERVAL_MS);
    });

    socket.addEventListener('message', (event) => {
      if (!current()) return;
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
      if (parsed.kind === 'sync_invalidate') getSyncOrchestrator().triggerDrain();
      if (parsed.kind === 'encounter_invalidate' && parsed.campaignId && parsed.encounterId)
        invalidateEncounter(parsed.campaignId, parsed.encounterId);
    });

    socket.addEventListener('close', () => {
      if (!current()) return;
      this.clearHandshakeTimeout();
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.socket = null;
      if (!opened) this.handshakeFailed();
      else this.scheduleReconnect();
    });
    // Browsers dispatch close after error. Reconnection is scheduled once.
    socket.addEventListener('error', () => {
      if (current()) this.publish('reconnecting');
    });
  }

  private handshakeFailed(): void {
    this.handshakeFailures++;
    if (this.handshakeFailures >= MAX_HANDSHAKE_FAILURES) {
      this.handshakeFailures = 0;
      this.attempts = 0;
      this.scheduleReconnect(HANDSHAKE_COOLDOWN_MS);
    } else this.scheduleReconnect();
  }

  private scheduleReconnect(delayOverrideMs?: number): void {
    if (!this.running || !this.sessionId || this.reconnectTimer) return;
    if (!connectionStore.canAttemptNetwork() || !connectionStore.status.online) {
      this.publish('offline');
      return;
    }
    this.publish('reconnecting');
    this.attempts++;
    const delay =
      delayOverrideMs ?? Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (this.attempts - 1));
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
  singleton?.stop();
  singleton = null;
}
