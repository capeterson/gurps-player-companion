import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db/client.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { enforceAuthRateLimit, normalizeRateLimitAccount, requestSource } from './rateLimit.ts';

configureIntegrationTestEnvironment();

async function sourceFor(headers: Record<string, string>, trustProxy = false) {
  const app = new Hono();
  app.get('/', (c) => c.text(requestSource(c, { ...integrationTestConfig, trustProxy })));
  const response = await app.request('/', { headers });
  return response.text();
}

describe('public auth rate-limit identities', () => {
  it('normalizes account identities without retaining formatting differences', () => {
    expect(normalizeRateLimitAccount('  Player@Example.COM ')).toBe('player@example.com');
  });

  it('uses Bun-supplied peer addresses unless an explicitly trusted proxy supplies the source', async () => {
    await expect(
      sourceFor({ 'x-gpc-client-ip': '192.0.2.1', 'x-forwarded-for': '198.51.100.4' }),
    ).resolves.toBe('192.0.2.1');
    await expect(
      sourceFor({ 'x-gpc-client-ip': '192.0.2.1', 'x-forwarded-for': '198.51.100.4' }, true),
    ).resolves.toBe('198.51.100.4');
  });
});

const testLimitConfig = {
  ...integrationTestConfig,
  trustProxy: true,
  authRateLimitWindowSeconds: 1,
  authRateLimitLoginMax: 2,
};

function limitTestApp() {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, 429, Object.fromEntries(error.getResponse().headers));
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
    expect(blocked.headers.get('retry-after')).toMatch(/^1$/);
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
    await Bun.sleep(1_100);
    expect((await request('three@example.com')).status).toBe(200);
  });
});
