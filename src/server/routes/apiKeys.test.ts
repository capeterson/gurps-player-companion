/**
 * Integration tests for the /auth/api-keys endpoints.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 * Start it with: bun run db:up (docker-compose.dev.yml)
 * Apply migrations first: bun run db:migrate
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

async function register(suffix = '') {
  const email = `apikey-test-${suffix}-${Date.now()}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: 'Test User' }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /api/v1/auth/api-keys', () => {
  it('creates a key; plaintextKey has gpc_ prefix format', async () => {
    const { accessToken } = await register('create');
    const res = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test key' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { apiKey: Record<string, unknown>; plaintextKey: string };
    expect(body.plaintextKey).toMatch(/^gpc_[A-Za-z0-9_-]+$/);
  });

  it('422 on empty name', async () => {
    const { accessToken } = await register('422empty');
    const res = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('422 on name longer than 80 chars', async () => {
    const { accessToken } = await register('422long');
    const res = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(81) }),
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/auth/api-keys', () => {
  it('returns keys; omits plaintextKey, keyHash, and prefix', async () => {
    const { accessToken } = await register('list-fields');
    await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'list test key' }),
    });
    const res = await app.request('/api/v1/auth/api-keys', {
      headers: bearer(accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body.length).toBeGreaterThan(0);
    const key = body[0];
    expect(key).not.toHaveProperty('plaintextKey');
    expect(key).not.toHaveProperty('keyHash');
    expect(key).not.toHaveProperty('prefix');
  });

  it("returns only the current user's keys", async () => {
    const a = await register('isolation-a');
    const b = await register('isolation-b');
    await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(a.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'user-a-only' }),
    });
    const res = await app.request('/api/v1/auth/api-keys', {
      headers: bearer(b.accessToken),
    });
    const body = (await res.json()) as { name: string }[];
    expect(body.some((k) => k.name === 'user-a-only')).toBe(false);
  });

  it('401 when unauthenticated', async () => {
    const res = await app.request('/api/v1/auth/api-keys');
    expect(res.status).toBe(401);
  });
});

describe('auth dispatch via API key', () => {
  it('GET /auth/me with API key bearer returns 200 with correct user', async () => {
    const { accessToken, email } = await register('dispatch');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dispatch test' }),
    });
    const { plaintextKey } = (await createRes.json()) as { plaintextKey: string };

    const meRes = await app.request('/api/v1/auth/me', { headers: bearer(plaintextKey) });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { email: string };
    expect(me.email).toBe(email);
  });

  it('revoked key is rejected with 401', async () => {
    const { accessToken } = await register('revoke');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'to be revoked' }),
    });
    const { plaintextKey, apiKey } = (await createRes.json()) as {
      plaintextKey: string;
      apiKey: { id: string };
    };

    await app.request(`/api/v1/auth/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });

    const meRes = await app.request('/api/v1/auth/me', { headers: bearer(plaintextKey) });
    expect(meRes.status).toBe(401);
  });

  it('lastUsedAt is set after API-key authentication', async () => {
    const { accessToken } = await register('lastused');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'lastused test' }),
    });
    const { plaintextKey, apiKey } = (await createRes.json()) as {
      plaintextKey: string;
      apiKey: { id: string; lastUsedAt: null };
    };
    expect(apiKey.lastUsedAt).toBeNull();

    await app.request('/api/v1/auth/me', { headers: bearer(plaintextKey) });
    // Allow the fire-and-forget DB write to settle
    await new Promise((r) => setTimeout(r, 200));

    const listRes = await app.request('/api/v1/auth/api-keys', {
      headers: bearer(accessToken),
    });
    const keys = (await listRes.json()) as { id: string; lastUsedAt: string | null }[];
    const row = keys.find((k) => k.id === apiKey.id);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it('JWT auth on /auth/me does not set lastUsedAt on key row', async () => {
    const { accessToken } = await register('jwt-no-update');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'jwt no update' }),
    });
    const { apiKey } = (await createRes.json()) as { apiKey: { id: string } };

    await app.request('/api/v1/auth/me', { headers: bearer(accessToken) });
    await new Promise((r) => setTimeout(r, 200));

    const listRes = await app.request('/api/v1/auth/api-keys', {
      headers: bearer(accessToken),
    });
    const keys = (await listRes.json()) as { id: string; lastUsedAt: string | null }[];
    const row = keys.find((k) => k.id === apiKey.id);
    expect(row?.lastUsedAt).toBeNull();
  });

  it.skip('lastUsedAt throttle: second use within 60s does not bump timestamp (requires time mock)', () => {});
});

describe('JWT-only gate', () => {
  it('GET /auth/api-keys with API key returns 403', async () => {
    const { accessToken } = await register('gate-get');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gate test' }),
    });
    const { plaintextKey } = (await createRes.json()) as { plaintextKey: string };

    const res = await app.request('/api/v1/auth/api-keys', { headers: bearer(plaintextKey) });
    expect(res.status).toBe(403);
  });

  it('POST /auth/api-keys with API key returns 403', async () => {
    const { accessToken } = await register('gate-post');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gate test' }),
    });
    const { plaintextKey } = (await createRes.json()) as { plaintextKey: string };

    const res = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(plaintextKey), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new key via api key' }),
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /auth/api-keys/{id} with API key returns 403', async () => {
    const { accessToken } = await register('gate-delete');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gate test' }),
    });
    const { plaintextKey, apiKey } = (await createRes.json()) as {
      plaintextKey: string;
      apiKey: { id: string };
    };

    const res = await app.request(`/api/v1/auth/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: bearer(plaintextKey),
    });
    expect(res.status).toBe(403);
  });
});

describe('ownership', () => {
  it("user A cannot delete user B's key (returns 404)", async () => {
    const a = await register('owner-a');
    const b = await register('owner-b');
    const createRes = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(b.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'b-exclusive' }),
    });
    const { apiKey } = (await createRes.json()) as { apiKey: { id: string } };

    const res = await app.request(`/api/v1/auth/api-keys/${apiKey.id}`, {
      method: 'DELETE',
      headers: bearer(a.accessToken),
    });
    expect(res.status).toBe(404);
  });
});
