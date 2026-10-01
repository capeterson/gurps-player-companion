import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

async function register(label: string) {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `experimental-features-${label}-${crypto.randomUUID()}@example.com`,
      password: 'ExperimentalFeaturesPassword1!',
      displayName: 'Experimental Features Test',
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function get(token: string) {
  return app.request('/api/v1/auth/experimental-features', { headers: headers(token) });
}

function patch(token: string, body: unknown) {
  return app.request('/api/v1/auth/experimental-features', {
    method: 'PATCH',
    headers: { ...headers(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/v1/auth/experimental-features', () => {
  it('defaults MCP UI off, saves strict booleans, and isolates account preferences', async () => {
    const first = await register('first');
    const second = await register('second');
    expect(await (await get(first)).json()).toEqual({ mcpUi: false });
    expect(await (await get(second)).json()).toEqual({ mcpUi: false });

    const enabled = await patch(first, { mcpUi: true });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ mcpUi: true });
    expect(await (await get(first)).json()).toEqual({ mcpUi: true });
    expect(await (await get(second)).json()).toEqual({ mcpUi: false });

    const disabled = await patch(first, { mcpUi: false });
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ mcpUi: false });
  });

  it('rejects malformed and unknown feature fields without changing the saved value', async () => {
    const token = await register('strict');
    expect((await patch(token, {})).status).toBe(422);
    expect((await patch(token, { mcpUi: 'true' })).status).toBe(422);
    expect((await patch(token, { mcpUi: true, otherFeature: true })).status).toBe(422);
    expect(await (await get(token)).json()).toEqual({ mcpUi: false });
  });

  it('requires an interactive JWT session for reads and writes', async () => {
    const token = await register('jwt-only');
    expect((await app.request('/api/v1/auth/experimental-features')).status).toBe(401);

    const createKey = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'experimental feature test' }),
    });
    expect(createKey.status).toBe(201);
    const { plaintextKey } = (await createKey.json()) as { plaintextKey: string };
    expect((await get(plaintextKey)).status).toBe(401);
    expect((await patch(plaintextKey, { mcpUi: true })).status).toBe(401);
  });
});
