import { afterEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import {
  NOTIFICATION_QUEUE_CHANNEL,
  NotificationMaintenance,
  type NotificationMaintenanceDependencies,
} from './notificationMaintenance.ts';

class FakeClient extends EventEmitter {
  connected = false;
  ended = false;
  queries: string[] = [];

  async connect() {
    this.connected = true;
  }

  async query(statement: string) {
    this.queries.push(statement);
    return {};
  }

  async end() {
    this.ended = true;
  }

  notify() {
    this.emit('notification', { channel: NOTIFICATION_QUEUE_CHANNEL, payload: '' });
  }

  disconnect() {
    this.emit('end');
  }
}

type FakeTimer = { callback: () => void; delay: number; active: boolean };
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await turn();
  expect(predicate()).toBe(true);
}

function harness(
  overrides: {
    createClient?: () => FakeClient;
    processEvents?: () => Promise<number>;
    hasPendingEvents?: () => Promise<boolean>;
    processEmails?: () => Promise<number>;
    nextEmailAttemptAt?: () => Promise<Date | null>;
  } = {},
) {
  const clients: FakeClient[] = [];
  const timers: FakeTimer[] = [];
  let now = 1_000_000;
  const maintenance = new NotificationMaintenance({
    createClient: (overrides.createClient ??
      (() => {
        const client = new FakeClient();
        clients.push(client);
        return client;
      })) as unknown as NotificationMaintenanceDependencies['createClient'],
    processEvents: overrides.processEvents ?? (async () => 0),
    hasPendingEvents: overrides.hasPendingEvents ?? (async () => false),
    processEmails: overrides.processEmails ?? (async () => 0),
    nextEmailAttemptAt: overrides.nextEmailAttemptAt ?? (async () => null),
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => {
      const found = timer as unknown as FakeTimer;
      found.active = false;
    },
  });
  return {
    clients,
    timers,
    maintenance,
    setNow(value: number) {
      now = value;
    },
    fireNextTimer() {
      const timer = timers.find((candidate) => candidate.active);
      expect(timer).toBeDefined();
      if (!timer) return;
      timer.active = false;
      timer.callback();
    },
  };
}

const running: NotificationMaintenance[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((maintenance) => maintenance.stop()));
});

describe('notification maintenance scheduler', () => {
  it('scans the durable backlog after LISTEN starts and has no idle polling timer', async () => {
    let eventCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => eventCalls === 1);
    expect(h.clients[0]?.queries).toEqual([`LISTEN ${NOTIFICATION_QUEUE_CHANNEL}`]);
    expect(h.timers.filter((timer) => timer.active)).toHaveLength(0);
  });

  it('keeps draining while processors report full 200 event and 10 mail batches', async () => {
    const eventCounts = [200, 0];
    const mailCounts = [10, 0];
    const h = harness({
      processEvents: async () => eventCounts.shift() ?? 0,
      processEmails: async () => mailCounts.shift() ?? 0,
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => eventCounts.length === 0 && mailCounts.length === 0);
    await turn();
    // Each pass handles each queue once, then a full batch requests another pass.
    expect(eventCounts).toEqual([]);
    expect(mailCounts).toEqual([]);
  });

  it('continues when either queue independently fills its batch', async () => {
    for (const [queue, expectedCalls] of [
      ['events', 2],
      ['mail', 2],
    ] as const) {
      let eventCalls = 0;
      let mailCalls = 0;
      const h = harness({
        processEvents: async () => {
          eventCalls++;
          return queue === 'events' && eventCalls === 1 ? 200 : 0;
        },
        processEmails: async () => {
          mailCalls++;
          return queue === 'mail' && mailCalls === 1 ? 10 : 0;
        },
      });
      running.push(h.maintenance);
      h.maintenance.start();
      await until(() => (queue === 'events' ? eventCalls : mailCalls) === expectedCalls);
      await h.maintenance.stop();
      running.splice(running.indexOf(h.maintenance), 1);
      expect(eventCalls).toBe(expectedCalls);
      expect(mailCalls).toBe(expectedCalls);
    }
  });

  it('does not lose a queue wakeup received while a pass is active', async () => {
    const firstPass = deferred();
    let eventCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        if (eventCalls === 1) await firstPass.promise;
        return 0;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => eventCalls === 1);
    h.clients[0]?.notify();
    firstPass.resolve();
    await until(() => eventCalls === 2);
  });

  it('ignores other channels and does not lose a wakeup during the deadline query', async () => {
    let eventCalls = 0;
    const deadline = deferred();
    let deadlineCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
      nextEmailAttemptAt: async () => {
        deadlineCalls++;
        if (deadlineCalls === 1) await deadline.promise;
        return null;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => deadlineCalls === 1);
    h.clients[0]?.emit('notification', { channel: 'some_other_channel', payload: '' });
    await turn();
    expect(eventCalls).toBe(1);
    h.clients[0]?.notify();
    deadline.resolve();
    await until(() => eventCalls === 2);
  });

  it('reconnects with backoff and rescans work missed while disconnected', async () => {
    let eventCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => eventCalls === 1);
    h.clients[0]?.disconnect();
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(1_000);
    h.fireNextTimer();
    await until(() => h.clients.length === 2 && eventCalls === 2);
    expect(h.clients[0]?.ended).toBe(true);
  });

  it('retries an initial LISTEN failure', async () => {
    let eventCalls = 0;
    const clients: FakeClient[] = [];
    const h = harness({
      createClient: () => {
        const client = new FakeClient();
        clients.push(client);
        if (clients.length === 1)
          client.query = async () => Promise.reject(new Error('listen failed'));
        return client;
      },
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(1_000);
    h.fireNextTimer();
    await until(() => clients.length === 2 && eventCalls === 1);
    expect(clients[0]?.ended).toBe(true);
  });

  it('schedules the next due email attempt and wakes when its deadline arrives', async () => {
    let eventCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
      nextEmailAttemptAt: async () => new Date(1_005_000),
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(5_000);
    h.setNow(1_005_000);
    h.fireNextTimer();
    await until(() => eventCalls === 2);
  });

  it('keeps a positive subsecond email deadline exact', async () => {
    const h = harness({
      nextEmailAttemptAt: async () => new Date(1_000_250),
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(250);
  });

  it('retries known locked history and returns to idle once the row clears', async () => {
    let eventCalls = 0;
    let pendingChecks = 0;
    let deadlineChecks = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        return 0;
      },
      hasPendingEvents: async () => ++pendingChecks === 1,
      nextEmailAttemptAt: async () => {
        deadlineChecks++;
        return deadlineChecks === 1 ? new Date(1_004_000) : null;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(1_000);
    h.fireNextTimer();
    await until(() => eventCalls === 2 && pendingChecks === 2);
    await turn();
    expect(h.timers.filter((timer) => timer.active)).toHaveLength(0);
  });

  it('uses the earlier mail deadline than the pending-history retry', async () => {
    const h = harness({
      hasPendingEvents: async () => true,
      nextEmailAttemptAt: async () => new Date(1_000_250),
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(250);
  });

  it('retries a processor failure on a bounded timer and returns to idle', async () => {
    let eventCalls = 0;
    const h = harness({
      processEvents: async () => {
        eventCalls++;
        if (eventCalls === 1) throw new Error('temporary database failure');
        return 0;
      },
    });
    running.push(h.maintenance);
    h.maintenance.start();
    await until(() => eventCalls === 1 && h.timers.some((timer) => timer.active));
    expect(h.timers.find((timer) => timer.active)?.delay).toBe(1_000);
    h.fireNextTimer();
    await until(() => eventCalls === 2);
    await turn();
    expect(h.timers.filter((timer) => timer.active)).toHaveLength(0);
  });

  it('waits for active work and closes the listener on shutdown', async () => {
    const processing = deferred();
    let processingStarted = false;
    const h = harness({
      processEvents: () => {
        processingStarted = true;
        return processing.promise.then(() => 0);
      },
    });
    h.maintenance.start();
    await until(() => processingStarted);
    let stopped = false;
    const stop = h.maintenance.stop().then(() => {
      stopped = true;
    });
    await turn();
    expect(stopped).toBe(false);
    processing.resolve();
    await stop;
    expect(stopped).toBe(true);
    expect(h.clients[0]?.ended).toBe(true);
    expect(h.timers.filter((timer) => timer.active)).toHaveLength(0);
  });

  it('does not create a listener when stopped immediately after start', async () => {
    const h = harness();
    h.maintenance.start();
    await h.maintenance.stop();
    await turn();
    expect(h.clients).toHaveLength(0);
  });

  it('closes a listener and avoids LISTEN when stopped during connect', async () => {
    const connecting = deferred();
    const h = harness({
      createClient: () => {
        const client = new FakeClient();
        client.connect = () => connecting.promise;
        h.clients.push(client);
        return client;
      },
    });
    h.maintenance.start();
    await until(() => h.clients.length === 1);
    const stopping = h.maintenance.stop();
    connecting.resolve();
    await stopping;
    expect(h.clients[0]?.ended).toBe(true);
    expect(h.clients[0]?.queries).toEqual([]);
  });
});
