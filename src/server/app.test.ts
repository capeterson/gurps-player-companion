import { describe, expect, it } from 'bun:test';
import { createApp } from './app.ts';
import type { AppConfig } from './config.ts';

const testConfig: AppConfig = {
  environment: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: 'postgres://test:test@localhost:5432/test',
  jwtSecret: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  jwtAccessTtlMinutes: 15,
  jwtRefreshTtlDays: 14,
  apiKeyPepper: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  corsOrigins: [],
};

describe('healthz', () => {
  const app = createApp(testConfig);

  it('returns ok', async () => {
    const res = await app.request('/api/v1/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('404s unknown routes under /api', async () => {
    const res = await app.request('/api/v1/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});

describe('/sync/ws routing', () => {
  const app = createApp(testConfig);

  // Browser WebSocket clients can't set Authorization headers, so the
  // /sync/ws endpoint authenticates via `?token=`.  The route is
  // registered before `syncRouter`, which would otherwise apply
  // `requireActiveUser` to /sync/* and 401 the handshake before the
  // token in the query string is read.  This test pins that ordering:
  // a plain GET (no Authorization, no Upgrade) must reach the WS
  // handler and fail with 401 "missing token", NOT 401 "unauthorized"
  // from the sync auth middleware.
  it('a request without Authorization reaches the ws handler (not the sync auth middleware)', async () => {
    const res = await app.request('/api/v1/sync/ws');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing token');
  });
});
