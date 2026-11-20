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
  it('defaults to the solar glass palettes and persists the alternate light palette', async () => {
    const token = await register();
    const initial = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      darkTheme: 'corona-obsidian',
      lightTheme: 'heliolance',
    });

    const dark = await patch(token, { darkTheme: 'corona-obsidian' });
    expect(dark.status).toBe(200);

    const light = await patch(token, { lightTheme: 'daybreak-lens' });
    expect(light.status).toBe(200);
    expect(await light.json()).toEqual({
      darkTheme: 'corona-obsidian',
      lightTheme: 'daybreak-lens',
    });

    const reread = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await reread.json()).toEqual({
      darkTheme: 'corona-obsidian',
      lightTheme: 'daybreak-lens',
    });

    // A stale client cannot reinstate retired palettes; slots remain mode-specific.
    for (const name of [
      'gilded-tome',
      'midnight-gilt',
      'verdigris-brass',
      'arcane-dark',
      'heliolance',
    ]) {
      expect((await patch(token, { darkTheme: name })).status).toBe(422);
    }
    for (const name of [
      'sunbolt',
      'illuminated-manuscript',
      'heraldic-vellum',
      'arcane-light',
      'corona-obsidian',
      'unknown-palette',
    ]) {
      expect((await patch(token, { lightTheme: name })).status).toBe(422);
    }
    expect((await patch(token, { mode: 'dark' })).status).toBe(422);
    expect((await patch(token, {})).status).toBe(422);
    const unchanged = await app.request('/api/v1/auth/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await unchanged.json()).toEqual({
      darkTheme: 'corona-obsidian',
      lightTheme: 'daybreak-lens',
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
    expect((await patch(plaintextKey, { lightTheme: 'daybreak-lens' })).status).toBe(401);
  });
});
