import { Client } from 'pg';
import { loadConfig } from '../config.ts';
import { isDraining } from '../lifecycle.ts';
import { nextNotificationEmailAttemptAt, processNotificationEmails } from './notificationEmails.ts';
import { hasPendingNotificationEvents, processNotificationEvents } from './notificationEvents.ts';

export const NOTIFICATION_QUEUE_CHANNEL = 'gpc_notification_queue';
type Timer = ReturnType<typeof setTimeout>;
export interface NotificationMaintenanceDependencies {
  createClient: () => Pick<Client, 'connect' | 'query' | 'on' | 'end'>;
  processEvents: () => Promise<number>;
  hasPendingEvents: () => Promise<boolean>;
  processEmails: () => Promise<number>;
  nextEmailAttemptAt: () => Promise<Date | null>;
  setTimer: (callback: () => void, delay: number) => Timer;
  clearTimer: (timer: Timer) => void;
  now: () => number;
}

/** NOTIFY is a wakeup only: durable queues and SKIP LOCKED remain authoritative. */
export class NotificationMaintenance {
  private readonly deps: NotificationMaintenanceDependencies;
  private running = false;
  private client: ReturnType<NotificationMaintenanceDependencies['createClient']> | undefined;
  private connecting: Promise<void> | undefined;
  private active: Promise<void> | undefined;
  private readonly closing = new Set<Promise<void>>();
  private requested = false;
  private workTimer: Timer | undefined;
  private reconnectTimer: Timer | undefined;
  private reconnectAttempts = 0;
  private processingFailures = 0;

  constructor(deps: Partial<NotificationMaintenanceDependencies> = {}) {
    this.deps = {
      createClient: () =>
        new Client({
          connectionString: loadConfig().databaseUrl,
          application_name: 'gpc-notification-listener',
          connectionTimeoutMillis: 5_000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
        }),
      processEvents: processNotificationEvents,
      hasPendingEvents: hasPendingNotificationEvents,
      processEmails: processNotificationEmails,
      nextEmailAttemptAt: nextNotificationEmailAttemptAt,
      setTimer: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        timer.unref();
        return timer;
      },
      clearTimer: clearTimeout,
      now: Date.now,
      ...deps,
    };
  }

  start(): void {
    if (this.running || isDraining()) return;
    this.running = true;
    this.connect();
  }

  private connect(): void {
    if (!this.running || isDraining() || this.connecting) return;
    // Defer so connecting is assigned before even a synchronous factory failure.
    this.connecting = Promise.resolve()
      .then(async () => {
        if (!this.running || isDraining()) return;
        const client = this.deps.createClient();
        this.client = client;
        client.on('notification', (message) => {
          if (client === this.client && message.channel === NOTIFICATION_QUEUE_CHANNEL) this.wake();
        });
        client.on('error', () => this.disconnected(client));
        client.on('end', () => this.disconnected(client));
        await client.connect();
        if (!this.running || client !== this.client) return;
        await client.query(`LISTEN ${NOTIFICATION_QUEUE_CHANNEL}`);
        if (!this.running || client !== this.client) return;
        this.reconnectAttempts = 0;
        // LISTEN must commit before the backlog scan, including on reconnect.
        this.wake();
      })
      .catch(() => {
        if (this.client) this.disconnected(this.client);
        else this.scheduleReconnect();
      })
      .finally(() => {
        this.connecting = undefined;
        if (!this.client) this.scheduleReconnect();
      });
  }

  private close(client: NonNullable<NotificationMaintenance['client']>): void {
    const closing = client.end().catch(() => undefined);
    this.closing.add(closing);
    void closing.finally(() => this.closing.delete(closing));
  }

  private disconnected(client: NonNullable<NotificationMaintenance['client']>): void {
    if (client !== this.client) return;
    this.client = undefined;
    this.close(client);
    if (this.running && !isDraining()) {
      console.error('notification listener disconnected; will reconnect');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || isDraining() || this.reconnectTimer) return;
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(this.reconnectAttempts++, 6));
    this.reconnectTimer = this.deps.setTimer(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private wake(): void {
    if (!this.running || isDraining()) return;
    this.requested = true;
    if (this.workTimer) this.deps.clearTimer(this.workTimer);
    this.workTimer = undefined;
    if (this.active) return;
    this.active = Promise.resolve()
      .then(() => this.drain())
      .catch(() => {
        console.error('notification processing failed; will retry');
        this.requested = false;
        this.scheduleWork(Math.min(60_000, 1_000 * 2 ** Math.min(this.processingFailures++, 6)));
      })
      .finally(() => {
        this.active = undefined;
        // A NOTIFY during a pass or the deadline query must not be lost.
        if (this.requested) this.wake();
      });
  }

  private async drain(): Promise<void> {
    while (this.running && !isDraining() && this.requested) {
      this.requested = false;
      const events = await this.deps.processEvents();
      const emails = await this.deps.processEmails();
      // One transaction claims bounded batches. Continue until the backlog drains.
      if (events === 200 || emails === 10) this.requested = true;
    }
    if (!this.running || isDraining()) return;
    // SKIP LOCKED can return an empty batch while another worker owns committed
    // history rows. Its rollback/crash emits no NOTIFY, so retry known work.
    const pendingEvents = await this.deps.hasPendingEvents();
    const nextAttempt = await this.deps.nextEmailAttemptAt();
    this.processingFailures = 0;
    let delay = pendingEvents ? 1_000 : null;
    if (nextAttempt) {
      // An already-due row may be locked by another worker; avoid a busy loop.
      const remaining = nextAttempt.getTime() - this.deps.now();
      const emailDelay = remaining > 0 ? remaining : 1_000;
      delay = delay === null ? emailDelay : Math.min(delay, emailDelay);
    }
    if (delay !== null) this.scheduleWork(delay);
  }

  private scheduleWork(delay: number): void {
    if (!this.running || isDraining()) return;
    if (this.workTimer) this.deps.clearTimer(this.workTimer);
    this.workTimer = this.deps.setTimer(
      () => {
        this.workTimer = undefined;
        this.wake();
      },
      Math.min(delay, 2_147_483_647),
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    this.requested = false;
    if (this.workTimer) this.deps.clearTimer(this.workTimer);
    if (this.reconnectTimer) this.deps.clearTimer(this.reconnectTimer);
    this.workTimer = this.reconnectTimer = undefined;
    // End the dedicated session even if connect/LISTEN is still in progress.
    const client = this.client;
    this.client = undefined;
    if (client) this.close(client);
    await this.connecting;
    await this.active;
    await Promise.all(this.closing);
  }
}

let worker: NotificationMaintenance | undefined;
export function startNotificationMaintenance(environment: string): void {
  if (worker || environment === 'test' || process.env.NODE_ENV === 'test' || isDraining()) return;
  worker = new NotificationMaintenance();
  worker.start();
}
export async function stopNotificationMaintenance(): Promise<void> {
  await worker?.stop();
  worker = undefined;
}
