import { describe, expect, it } from 'bun:test';
import { and, eq, isNull } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { refreshTokens } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { verifyRefreshToken } from './jwt.ts';
import { rotateRefreshToken } from './session.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

async function register(suffix: string) {
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `refresh-rotation-${suffix}-${crypto.randomUUID()}@example.com`,
      password: 'TestPassword1!',
      displayName: 'Rotation Test',
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { accessToken: string; refreshToken: string };
}

async function refresh(rawToken: string, requestId: string) {
  return app.request('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rawToken, requestId }),
  });
}

describe('transactional idempotent refresh rotation', () => {
  it('leaves the old token usable when replacement insertion fails', async () => {
    const initial = await register('rollback');
    const payload = await verifyRefreshToken(initial.refreshToken);

    // Reusing the parent's JTI forces the replacement INSERT to violate the
    // unique index after the parent row has been locked. The transaction must
    // roll back the consume along with the failed insert.
    await expect(
      rotateRefreshToken(initial.refreshToken, crypto.randomUUID(), payload.jti),
    ).rejects.toThrow();

    const retry = await refresh(initial.refreshToken, crypto.randomUUID());
    expect(retry.status).toBe(200);
  });

  it('returns the same live replacement when a lost response is retried', async () => {
    const initial = await register('idempotent');
    const requestId = crypto.randomUUID();
    const first = await refresh(initial.refreshToken, requestId);
    const second = await refresh(initial.refreshToken, requestId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstPair = (await first.json()) as { refreshToken: string };
    const secondPair = (await second.json()) as { refreshToken: string };
    expect(secondPair.refreshToken).toBe(firstPair.refreshToken);

    const descendant = await refresh(firstPair.refreshToken, crypto.randomUUID());
    expect(descendant.status).toBe(200);
  });

  it('allows only one concurrent descendant and revokes the family on conflicting reuse', async () => {
    const initial = await register('concurrent');
    const payload = await verifyRefreshToken(initial.refreshToken);
    const [parent] = await getDb()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, payload.jti));
    if (!parent) throw new Error('parent refresh row missing');

    const responses = await Promise.all([
      refresh(initial.refreshToken, crypto.randomUUID()),
      refresh(initial.refreshToken, crypto.randomUUID()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const active = await getDb()
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, parent.familyId), isNull(refreshTokens.revokedAt)));
    expect(active).toHaveLength(0);
  });

  it('rejects the same request id outside the retry window and revokes its descendant', async () => {
    const initial = await register('window');
    const payload = await verifyRefreshToken(initial.refreshToken);
    const requestId = crypto.randomUUID();
    const first = await refresh(initial.refreshToken, requestId);
    expect(first.status).toBe(200);

    await getDb()
      .update(refreshTokens)
      .set({ rotatedAt: new Date(Date.now() - 31_000) })
      .where(eq(refreshTokens.jti, payload.jti));
    const replay = await refresh(initial.refreshToken, requestId);
    expect(replay.status).toBe(401);

    const [parent] = await getDb()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.jti, payload.jti));
    if (!parent) throw new Error('parent refresh row missing');
    const active = await getDb()
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, parent.familyId), isNull(refreshTokens.revokedAt)));
    expect(active).toHaveLength(0);
  });
});
