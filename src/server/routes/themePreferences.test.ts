import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

async function register(): Promise<string> {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `theme-prefs-${crypto.randomUUID()}@example.com`,
      password: 'ThemePassword1!',
      displayName: 'Theme Test',
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

function patch(token: string, body: unknown) {
  return app.request('/api/v1/auth/preferences', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/v1/auth/preferences', () => {
  it('defaults to the Gilded Tome and Illuminated Manuscript palettes and persists changes', async () => {
    const token = await register();
    const initial = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      darkTheme: 'gilded-tome',
      lightTheme: 'illuminated-manuscript',
    });

    const dark = await patch(token, { darkTheme: 'midnight-gilt' });
    expect(dark.status).toBe(200);
    expect(await dark.json()).toEqual({
      darkTheme: 'midnight-gilt',
      lightTheme: 'illuminated-manuscript',
    });

    const verdigris = await patch(token, { darkTheme: 'verdigris-brass' });
    expect(verdigris.status).toBe(200);
    expect(((await verdigris.json()) as { darkTheme: string }).darkTheme).toBe('verdigris-brass');
    expect((await patch(token, { darkTheme: 'midnight-gilt' })).status).toBe(200);

    const light = await patch(token, { lightTheme: 'heraldic-vellum' });
    expect(await light.json()).toEqual({
      darkTheme: 'midnight-gilt',
      lightTheme: 'heraldic-vellum',
    });

    const reread = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await reread.json()).toEqual({
      darkTheme: 'midnight-gilt',
      lightTheme: 'heraldic-vellum',
    });

    const arcaneDark = await patch(token, { darkTheme: 'arcane-dark' });
    expect(arcaneDark.status).toBe(200);
    expect(await arcaneDark.json()).toEqual({
      darkTheme: 'arcane-dark',
      lightTheme: 'heraldic-vellum',
    });
    const arcaneLight = await patch(token, { lightTheme: 'arcane-light' });
    expect(arcaneLight.status).toBe(200);
    expect(await arcaneLight.json()).toEqual({
      darkTheme: 'arcane-dark',
      lightTheme: 'arcane-light',
    });
    const restored = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      darkTheme: 'arcane-dark',
      lightTheme: 'arcane-light',
    });

    // Validation: a light palette in the dark slot, unknown names, unknown
    // keys, and an empty body are all rejected without changing the row.
    expect((await patch(token, { darkTheme: 'heraldic-vellum' })).status).toBe(422);
    expect((await patch(token, { lightTheme: 'unknown-palette' })).status).toBe(422);
    expect((await patch(token, { darkTheme: 'arcane-light' })).status).toBe(422);
    expect((await patch(token, { lightTheme: 'arcane-dark' })).status).toBe(422);
    expect((await patch(token, { mode: 'dark' })).status).toBe(422);
    expect((await patch(token, {})).status).toBe(422);
    const unchanged = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await unchanged.json()).toEqual({
      darkTheme: 'arcane-dark',
      lightTheme: 'arcane-light',
    });
  });

  it('is limited to interactive sessions', async () => {
    const token = await register();
    const unauthenticated = await app.request('/api/v1/auth/preferences');
    expect(unauthenticated.status).toBe(401);

    const createKey = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'theme key' }),
    });
    expect(createKey.status).toBe(201);
    const { plaintextKey } = (await createKey.json()) as { plaintextKey: string };
    expect((await patch(plaintextKey, { darkTheme: 'midnight-gilt' })).status).toBe(401);
  });
});
