import { describe, expect, it } from 'bun:test';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../shared/schemas/notificationPreferences.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

async function register(): Promise<string> {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `notification-prefs-${crypto.randomUUID()}@example.com`,
      password: 'NotificationPassword1!',
      displayName: 'Notification Test',
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

function get(token: string) {
  return app.request('/api/v1/auth/notification-preferences', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function patch(token: string, body: unknown) {
  return app.request('/api/v1/auth/notification-preferences', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/v1/auth/notification-preferences', () => {
  it('defaults all in-app topics and only the supported invitation emails on, then persists changes', async () => {
    const token = await register();
    const initial = await get(token);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);

    const firstPatch = await patch(token, { emailInvitations: false, characterChanges: false });
    expect(firstPatch.status).toBe(200);
    expect(await firstPatch.json()).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      emailInvitations: false,
      characterChanges: false,
    });

    const secondPatch = await patch(token, { emailInvitationAccepted: false, points: false });
    expect(secondPatch.status).toBe(200);
    const updated = await secondPatch.json();
    expect(updated).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      emailInvitations: false,
      emailInvitationAccepted: false,
      characterChanges: false,
      points: false,
    });

    expect(await (await get(token)).json()).toEqual(updated);
  });

  it('rejects empty, unsupported, or unknown patches without changing saved values', async () => {
    const token = await register();
    expect((await patch(token, {})).status).toBe(422);
    expect((await patch(token, { desktopEnabled: true })).status).toBe(422);
    expect((await patch(token, { security: false })).status).toBe(422);
    expect((await patch(token, { membership: 'false' })).status).toBe(422);
    expect(await (await get(token)).json()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('requires an interactive JWT session', async () => {
    const token = await register();
    expect((await app.request('/api/v1/auth/notification-preferences')).status).toBe(401);

    const createKey = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'notification preferences test' }),
    });
    expect(createKey.status).toBe(201);
    const { plaintextKey } = (await createKey.json()) as { plaintextKey: string };
    expect((await get(plaintextKey)).status).toBe(401);
    expect((await patch(plaintextKey, { membership: false })).status).toBe(401);
  });
});
