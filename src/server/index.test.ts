import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { resetConfigCache } from './config.ts';
import { getDb } from './db/client.ts';
import { users } from './db/schema.ts';
import { startServer } from './index.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from './testConfig.ts';

configureIntegrationTestEnvironment();

describe('Bun public auth transport', () => {
  let server: ReturnType<typeof startServer>;
  const userIds: string[] = [];

  beforeEach(async () => {
    configureIntegrationTestEnvironment();
    process.env.AUTH_RATE_LIMIT_LOGIN_MAX = '2';
    process.env.AUTH_RATE_LIMIT_REGISTER_MAX = '2';
    process.env.AUTH_RATE_LIMIT_RESET_MAX = '2';
    process.env.AUTH_RATE_LIMIT_CHALLENGE_MAX = '2';
    resetConfigCache();
    await getDb().execute(sql`delete from auth_rate_limits`);
    server = startServer(integrationTestConfig);
  });

  afterEach(async () => {
    server.stop(true);
    for (const id of userIds.splice(0)) await getDb().delete(users).where(eq(users.id, id));
    await getDb().execute(sql`delete from auth_rate_limits`);
    configureIntegrationTestEnvironment();
  });

  function post(path: string, body: unknown, spoof = '203.0.113.1') {
    return fetch(new URL(`/api/v1/auth/${path}`, server.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gpc-client-ip': spoof,
        'x-forwarded-for': spoof,
      },
      body: JSON.stringify(body),
    });
  }

  it('limits password login by the real peer and keeps 401/429 responses JSON', async () => {
    for (let i = 0; i < 3; i++) {
      const response = await post(
        'login',
        {
          email: `missing-${i}@example.com`,
          password: 'wrong-password',
        },
        `203.0.113.${i + 1}`,
      );
      expect(response.status).toBe(i < 2 ? 401 : 429);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toHaveProperty('error');
      if (i === 2) expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    }
  });

  it('limits accountless passkey options even when client IP headers change', async () => {
    for (let i = 0; i < 3; i++) {
      const response = await post('passkeys/login/options', {}, `203.0.113.${i + 1}`);
      expect(response.status).toBe(i < 2 ? 200 : 429);
      await response.body?.cancel();
    }
  });

  it('shares the passkey source budget with assertion verification', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await post('passkeys/login/options', {});
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }
    const response = await post('passkeys/login', {
      id: 'invalid',
      rawId: 'invalid',
      type: 'public-key',
      response: { clientDataJSON: 'invalid', authenticatorData: 'invalid', signature: 'invalid' },
    });
    expect(response.status).toBe(429);
    await response.body?.cancel();
  });

  it('limits password recovery and reset before token work', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await post('forgot-password', { email: `reset-${i}@example.com` });
      expect(response.status).toBe(200);
      await response.body?.cancel();
    }
    const response = await post('reset-password', {
      token: 'invalid',
      newPassword: 'new-password',
    });
    expect(response.status).toBe(429);
    await response.body?.cancel();
  });

  it('limits registration before inserting a user and preserves authenticated sync upgrades', async () => {
    let accessToken = '';
    for (let i = 0; i < 3; i++) {
      const email = `transport-${crypto.randomUUID()}@example.com`;
      const response = await post('register', {
        email,
        password: 'test-password',
        displayName: 'Test',
      });
      const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
      userIds.push(...rows.map((row) => row.id));
      expect(response.status).toBe(i < 2 ? 201 : 429);
      expect(rows).toHaveLength(i < 2 ? 1 : 0);
      const body = (await response.json()) as { accessToken?: string };
      if (body.accessToken) accessToken = body.accessToken;
    }

    const url = new URL('/api/v1/sync/ws', server.url);
    url.protocol = 'ws:';
    url.searchParams.set('token', accessToken);
    const ws = new WebSocket(url);
    try {
      const messages = await new Promise<string[]>((resolve, reject) => {
        const received: string[] = [];
        const timeout = setTimeout(() => reject(new Error('WebSocket handshake timed out')), 2000);
        ws.onmessage = (event) => {
          received.push(String(event.data));
          if (received.length === 1) ws.send('ping');
          else {
            clearTimeout(timeout);
            resolve(received);
          }
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket upgrade failed'));
        };
      });
      expect(JSON.parse(messages[0] ?? '')).toHaveProperty('kind', 'hello');
      expect(messages[1]).toBe('pong');
    } finally {
      ws.close();
    }
  });
});
