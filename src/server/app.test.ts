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
