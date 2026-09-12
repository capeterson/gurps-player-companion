import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { signAccessToken, verifyAccessToken } from '../auth/jwt.ts';
import { getDb } from '../db/client.ts';
import { passkeyCredentials, passwordResetTokens, users } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

interface RegisteredSession {
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
}

async function register(suffix: string): Promise<RegisteredSession> {
  const email = `auth-security-${suffix}-${crypto.randomUUID()}@example.com`;
  const password = 'OriginalPassword1!';
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Security Test' }),
  });
  expect(response.status).toBe(201);
  const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
  return { ...tokens, email, password };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function installResetToken(email: string, rawToken: string): Promise<string> {
  const [user] = await getDb().select().from(users).where(eq(users.email, email));
  if (!user) throw new Error('registered user missing');
  await getDb()
    .insert(passwordResetTokens)
    .values({
      userId: user.id,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
    });
  return user.id;
}

describe('authentication recovery revocation', () => {
  it('rejects every old JWT and removes persistent credentials after password recovery', async () => {
    const session = await register('recovery');
    const createKey = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(session.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pre-recovery key' }),
    });
    expect(createKey.status).toBe(201);
    const { plaintextKey } = (await createKey.json()) as { plaintextKey: string };

    const rawReset = crypto.randomUUID();
    const userId = await installResetToken(session.email, rawReset);
    await getDb()
      .insert(passkeyCredentials)
      .values({
        userId,
        credentialId: `credential-${crypto.randomUUID()}`,
        publicKey: 'test-public-key',
        signCount: 0,
        name: 'Pre-recovery passkey',
      });

    const reset = await app.request('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: rawReset, newPassword: 'RecoveredPassword2!' }),
    });
    expect(reset.status).toBe(204);

    const oldMe = await app.request('/api/v1/auth/me', {
      headers: bearer(session.accessToken),
    });
    expect(oldMe.status).toBe(401);
    const oldRefresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    expect(oldRefresh.status).toBe(401);
    const oldPasskeyEnrollment = await app.request('/api/v1/auth/passkeys/register/options', {
      method: 'POST',
      headers: bearer(session.accessToken),
    });
    expect(oldPasskeyEnrollment.status).toBe(401);
    const oldKeyCreation = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(session.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'attacker persistence' }),
    });
    expect(oldKeyCreation.status).toBe(401);
    const oldApiKey = await app.request('/api/v1/auth/me', { headers: bearer(plaintextKey) });
    expect(oldApiKey.status).toBe(401);
    expect(
      await getDb().select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, userId)),
    ).toHaveLength(0);

    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: session.email, password: 'RecoveredPassword2!' }),
    });
    expect(login.status).toBe(200);
    const fresh = (await login.json()) as { accessToken: string };
    const legitimateKey = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(fresh.accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'post-recovery key' }),
    });
    expect(legitimateKey.status).toBe(201);
  });

  it('requires a primary authentication ceremony within ten minutes for new credentials', async () => {
    const session = await register('recent');
    const [user] = await getDb().select().from(users).where(eq(users.email, session.email));
    if (!user) throw new Error('registered user missing');
    const stale = await signAccessToken(
      user.id,
      user.authVersion,
      Math.floor(Date.now() / 1000) - 601,
    );

    const key = await app.request('/api/v1/auth/api-keys', {
      method: 'POST',
      headers: { ...bearer(stale.token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'too late' }),
    });
    expect(key.status).toBe(403);
    const passkey = await app.request('/api/v1/auth/passkeys/register/options', {
      method: 'POST',
      headers: bearer(stale.token),
    });
    expect(passkey.status).toBe(403);
  });

  it('does not make a session recent again merely by refreshing it', async () => {
    const session = await register('refresh-auth-time');
    const before = await verifyAccessToken(session.accessToken);
    const refreshed = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    expect(refreshed.status).toBe(200);
    const pair = (await refreshed.json()) as { accessToken: string };
    const after = await verifyAccessToken(pair.accessToken);
    expect(after.authTime).toBe(before.authTime);
  });
});
