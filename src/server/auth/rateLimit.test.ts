import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db/client.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { enforceAuthRateLimit, normalizeRateLimitAccount, requestSource } from './rateLimit.ts';

configureIntegrationTestEnvironment();

async function sourceFor(headers: Record<string, string>, trustProxy = false, env = {}) {
  const app = new Hono();
  app.get('/', (c) => c.text(requestSource(c, { ...integrationTestConfig, trustProxy })));
  const response = await app.request('/', { headers }, env);
  return response.text();
}

describe('public auth rate-limit identities', () => {
  it('normalizes account identities without retaining formatting differences', () => {
    expect(normalizeRateLimitAccount('  Player@Example.COM ')).toBe('player@example.com');
  });

  it('uses Bun-supplied peer addresses unless an explicitly trusted proxy supplies the source', async () => {
    const peer = { requestIP: () => ({ address: '192.0.2.1' }) };
    await expect(
      sourceFor(
        { 'x-gpc-client-ip': '203.0.113.1', 'x-forwarded-for': '198.51.100.4' },
        false,
        peer,
      ),
    ).resolves.toBe('192.0.2.1');
    await expect(sourceFor({ 'x-forwarded-for': '198.51.100.4' }, true, peer)).resolves.toBe(
      '198.51.100.4',
    );
    await expect(sourceFor({}, true, peer)).resolves.toBe('192.0.2.1');
    await expect(sourceFor({}, false, { server: peer })).resolves.toBe('192.0.2.1');
  });

  it('uses the Vite socket and never trusts a client-supplied private header', async () => {
    await expect(
      sourceFor({ 'x-gpc-client-ip': '203.0.113.1' }, false, {
        incoming: { socket: { remoteAddress: '192.0.2.2' } },
      }),
    ).resolves.toBe('192.0.2.2');
    await expect(sourceFor({ 'x-gpc-client-ip': '203.0.113.1' })).resolves.toBe('unknown');
    await expect(sourceFor({}, false, { requestIP: () => null })).resolves.toBe('unknown');
  });
});

const testLimitConfig = {
  ...integrationTestConfig,
  trustProxy: true,
  authRateLimitWindowSeconds: 600,
  authRateLimitLoginMax: 2,
};

function limitTestApp() {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    return c.json({ error: 'internal_error' }, 500);
  });
  app.get('/', async (c) => {
    await enforceAuthRateLimit(c, testLimitConfig, 'login', c.req.query('email'));
    return c.json({ ok: true });
  });
  return app;
}

describe('durable public auth rate limits', () => {
  beforeEach(async () => {
    await getDb().execute(sql`delete from auth_rate_limits`);
  });

  afterEach(async () => {
    await getDb().execute(sql`delete from auth_rate_limits`);
  });

  it('shares a normalized account bucket across distributed sources', async () => {
    const app = limitTestApp();
    const request = (email: string, source: string) =>
      app.request(`/?email=${encodeURIComponent(email)}`, {
        headers: { 'x-forwarded-for': source },
      });

    expect((await request('Player@Example.com', '192.0.2.1')).status).toBe(200);
    expect((await request('player@example.com', '192.0.2.2')).status).toBe(200);
    const blocked = await request('PLAYER@example.com', '192.0.2.3');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ error: 'too many requests; please try again later' });
  });

  it('bounds a single source across distinct accounts and permits a retry after expiry', async () => {
    const app = limitTestApp();
    const request = (email: string) =>
      app.request(`/?email=${encodeURIComponent(email)}`, {
        headers: { 'x-forwarded-for': '198.51.100.1' },
      });

    expect((await request('one@example.com')).status).toBe(200);
    expect((await request('two@example.com')).status).toBe(200);
    expect((await request('three@example.com')).status).toBe(429);
    await getDb().execute(
      sql`update auth_rate_limits set expires_at = now() - interval '1 second'`,
    );
    expect((await request('three@example.com')).status).toBe(200);
  });

  it('does not allocate or consume account buckets after the source is blocked', async () => {
    const app = limitTestApp();
    const request = (email: string, source = '198.51.100.1') =>
      app.request(`/?email=${encodeURIComponent(email)}`, {
        headers: { 'x-forwarded-for': source },
      });
    expect((await request('one@example.com')).status).toBe(200);
    expect((await request('two@example.com')).status).toBe(200);
    for (let i = 0; i < 10; i++) {
      expect((await request(`blocked-${i}@example.com`)).status).toBe(429);
    }
    expect((await request('one@example.com')).status).toBe(429);
    const rows = await getDb().execute(sql`select key from auth_rate_limits where scope = 'login'`);
    expect(rows.rows).toHaveLength(3); // one source, two admitted accounts
    expect((await request('one@example.com', '198.51.100.2')).status).toBe(200);
  });

  it('admits only the configured budget under concurrent requests across app instances', async () => {
    const firstApp = limitTestApp();
    const secondApp = limitTestApp();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? firstApp : secondApp).request(`/?email=concurrent-${i}@example.com`, {
          headers: { 'x-forwarded-for': '198.51.100.3' },
        }),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(18);
    const rows = await getDb().execute(sql`select key from auth_rate_limits where scope = 'login'`);
    expect(rows.rows).toHaveLength(3);
  });
});
