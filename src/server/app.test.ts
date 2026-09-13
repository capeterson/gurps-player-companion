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
  resendApiKey: undefined,
  resendFromEmail: undefined,
  appBaseUrl: undefined,
  oauthClients: [],
  trustProxy: false,
  authRateLimitWindowSeconds: 600,
  authRateLimitLoginMax: 10,
  authRateLimitRegisterMax: 5,
  authRateLimitResetMax: 3,
  authRateLimitChallengeMax: 10,
};

describe('healthz', () => {
  const app = createApp(testConfig);

  it('returns ok', async () => {
    const res = await app.request('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('assigns a new trusted correlation ID to each request', async () => {
    const suppliedId = '00000000-0000-4000-8000-000000000000';
    const first = await app.request('/api/v1/healthz', {
      headers: { 'x-request-id': suppliedId },
    });
    const second = await app.request('/api/v1/healthz');
    expect(first.headers.get('x-request-id')).not.toBe(suppliedId);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
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

describe('configured browser OAuth CORS', () => {
  const origin = 'https://agent.example';
  const app = createApp({ ...testConfig, corsOrigins: [origin] });

  for (const [method, path] of [
    ['GET', '/.well-known/oauth-protected-resource/mcp'],
    ['GET', '/.well-known/oauth-authorization-server'],
    ['POST', '/oauth/token'],
    ['POST', '/oauth/revoke'],
    ['POST', '/oauth/register'],
    ['POST', '/mcp'],
  ] as const) {
    it(`answers ${path} preflight for an allowed browser client`, async () => {
      const response = await app.request(path, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    });
  }
});
