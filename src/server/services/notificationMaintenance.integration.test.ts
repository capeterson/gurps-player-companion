import { afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { entityHistory, notifications } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { NOTIFICATION_QUEUE_CHANNEL, NotificationMaintenance } from './notificationMaintenance.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
const workers: NotificationMaintenance[] = [];

function decodeUserId(accessToken: string): string {
  const segment = accessToken.split('.')[1];
  if (!segment) throw new Error('malformed JWT');
  return (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { sub: string }).sub;
}

async function registerUser(label: string) {
  const email = `notification-maintenance-${label}-${crypto.randomUUID()}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'NotificationMaintenance1!', displayName: label }),
  });
  expect(response.status).toBe(201);
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { accessToken, userId: decodeUserId(accessToken) };
}

async function waitFor(condition: () => Promise<boolean>, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await condition()) return;
    await Bun.sleep(10);
  }
  expect(await condition()).toBe(true);
}

async function addHistory(ownerUserId: string, actorUserId: string, name: string): Promise<void> {
  await getDb()
    .insert(entityHistory)
    .values({
      revision: Date.now(),
      scope: 'character',
      entityClass: 'character',
      entityId: crypto.randomUUID(),
      op: 'update',
      ownerUserId,
      actorUserId,
      oldRow: { name: `${name} old` },
      newRow: { name },
    });
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
});

describe('PostgreSQL notification wakeups', () => {
  it('notifies only after a queue insert commits', async () => {
    const user = await registerUser('transaction');
    const listener = new Client({ connectionString: integrationTestConfig.databaseUrl });
    await listener.connect();
    await listener.query(`LISTEN ${NOTIFICATION_QUEUE_CHANNEL}`);
    const received: string[] = [];
    listener.on('notification', (message) => received.push(message.channel));
    const writer = new Client({ connectionString: integrationTestConfig.databaseUrl });
    await writer.connect();
    try {
      await writer.query('BEGIN');
      const committedKey = `committed:${crypto.randomUUID()}`;
      await writer.query(
        `INSERT INTO notification_email_queue(user_id, kind, event_key, subject, message)
         VALUES ($1, 'security', $2, 'test', 'test')`,
        [user.userId, committedKey],
      );
      await writer.query('COMMIT');
      await waitFor(async () => received.length === 1);
      expect(received).toEqual([NOTIFICATION_QUEUE_CHANNEL]);

      await writer.query('BEGIN');
      await writer.query(
        `UPDATE notification_email_queue SET next_attempt_at = now() + interval '1 minute'
         WHERE event_key = $1`,
        [committedKey],
      );
      await Bun.sleep(75);
      expect(received).toHaveLength(1);
      await writer.query('COMMIT');
      await waitFor(async () => received.length === 2);

      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO notification_email_queue(user_id, kind, event_key, subject, message)
         VALUES ($1, 'security', $2, 'test', 'test')`,
        [user.userId, `rolled-back:${crypto.randomUUID()}`],
      );
      await writer.query('ROLLBACK');
      await Bun.sleep(75);
      expect(received).toEqual([NOTIFICATION_QUEUE_CHANNEL, NOTIFICATION_QUEUE_CHANNEL]);
    } finally {
      await writer.end();
      await listener.end();
    }
  });

  it('starts by scanning a committed history backlog and delivers it through the real worker', async () => {
    const owner = await registerUser('backlog-owner');
    const actor = await registerUser('backlog-actor');
    await addHistory(owner.userId, actor.userId, 'After');

    const worker = new NotificationMaintenance({
      processEmails: async () => 0,
      nextEmailAttemptAt: async () => null,
    });
    workers.push(worker);
    worker.start();
    await waitFor(async () => {
      const [row] = await getDb()
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.userId, owner.userId));
      return Boolean(row);
    });
    const [notice] = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.userId));
    expect(notice?.payload).toMatchObject({
      title: 'After old was updated',
      actorId: actor.userId,
    });

    // The worker is idle and LISTEN is committed. This queue insert must wake
    // it immediately instead of waiting for a periodic scan.
    const secondOwner = await registerUser('live-owner');
    const secondActor = await registerUser('live-actor');
    await addHistory(secondOwner.userId, secondActor.userId, 'Live update');
    await waitFor(async () => {
      const [row] = await getDb()
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.userId, secondOwner.userId));
      return Boolean(row);
    });
  });

  it('rescans work inserted while its PostgreSQL listener reconnects', async () => {
    const initialOwner = await registerUser('reconnect-initial-owner');
    const initialActor = await registerUser('reconnect-initial-actor');
    await addHistory(initialOwner.userId, initialActor.userId, 'Initial backlog');
    const listeners: Client[] = [];
    const worker = new NotificationMaintenance({
      createClient: () => {
        const client = new Client({ connectionString: integrationTestConfig.databaseUrl });
        listeners.push(client);
        return client;
      },
      processEmails: async () => 0,
      nextEmailAttemptAt: async () => null,
    });
    workers.push(worker);
    worker.start();
    await waitFor(async () => {
      const [row] = await getDb()
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.userId, initialOwner.userId));
      return Boolean(row) && listeners.length === 1;
    });

    let disconnectedResolve!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      disconnectedResolve = resolve;
    });
    const listener = listeners[0];
    expect(listener).toBeDefined();
    if (!listener) throw new Error('notification listener was not created');
    listener.once('end', disconnectedResolve);
    const result = await listener.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = result.rows[0]?.pid;
    expect(pid).toBeDefined();
    if (pid === undefined) throw new Error('listener backend PID is missing');
    const terminator = new Client({ connectionString: integrationTestConfig.databaseUrl });
    await terminator.connect();
    try {
      await terminator.query('SELECT pg_terminate_backend($1)', [pid]);
      await disconnected;
      const missedOwner = await registerUser('reconnect-missed-owner');
      const missedActor = await registerUser('reconnect-missed-actor');
      await addHistory(missedOwner.userId, missedActor.userId, 'Missed while disconnected');
      await waitFor(async () => {
        const [row] = await getDb()
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.userId, missedOwner.userId));
        return Boolean(row) && listeners.length >= 2;
      }, 600);
    } finally {
      await terminator.end();
    }
  });
});
