import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../app.ts';
import { signAccessToken } from '../auth/jwt.ts';
import { getDb } from '../db/client.ts';
import { apiKeys, oauthClients, oauthGrants, refreshTokens, users } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
const userIds: string[] = [];
const clientIds: string[] = [];

afterEach(async () => {
  if (userIds.length)
    await getDb()
      .delete(users)
      .where(inArray(users.id, userIds.splice(0)));
  if (clientIds.length)
    await getDb()
      .delete(oauthClients)
      .where(inArray(oauthClients.id, clientIds.splice(0)));
});

async function account(isSuperuser = false) {
  const [user] = await getDb()
    .insert(users)
    .values({
      email: `admin-test-${randomUUID()}@example.com`,
      displayName: 'Admin test',
      passwordHash: 'unused',
      isSuperuser,
    })
    .returning();
  if (!user) throw new Error('fixture failed');
  userIds.push(user.id);
  const { token } = await signAccessToken(user.id);
  return { ...user, token };
}
function action(actor: { token: string }, userId: string, name: string) {
  return app.request(`/api/v1/admin/users/${userId}/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actor.token}` },
  });
}

describe('admin account lifecycle', () => {
  it('requires an active superuser and blocks self-actions even with uppercase UUIDs', async () => {
    const admin = await account(true);
    const member = await account();
    expect((await action(member, admin.id, 'purge')).status).toBe(403);
    expect((await app.request('/api/v1/admin/users')).status).toBe(401);
    for (const name of ['purge', 'suspend', 'unsuspend']) {
      expect((await action(admin, admin.id.toUpperCase(), name)).status).toBe(400);
    }
    expect((await action(admin, randomUUID(), 'purge')).status).toBe(404);
  });

  it('schedules 30 days ahead, rebases the deadline, and cancels without unsuspending', async () => {
    const admin = await account(true);
    const member = await account();
    const before = Date.now();
    const response = await action(admin, member.id, 'purge');
    expect(response.status).toBe(200);
    const scheduled = await response.json();
    expect(scheduled.isActive).toBe(false);
    expect(new Date(scheduled.purgeScheduledAt).getTime()).toBeGreaterThanOrEqual(
      before + 30 * 86400000,
    );
    expect(new Date(scheduled.purgeScheduledAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 86400000,
    );
    expect((await action(admin, member.id, 'unsuspend')).status).toBe(409);
    const rebased = await (await action(admin, member.id, 'purge')).json();
    expect(new Date(rebased.purgeScheduledAt).getTime()).toBeGreaterThanOrEqual(
      new Date(scheduled.purgeScheduledAt).getTime(),
    );
    const cancelled = await (await action(admin, member.id, 'cancel-purge')).json();
    expect(cancelled.purgeScheduledAt).toBeNull();
    expect(cancelled.isActive).toBe(false);
    const restored = await (await action(admin, member.id, 'unsuspend')).json();
    expect(restored.isActive).toBe(true);
    // Revoked sessions must not resurrect when an administrator unsuspends.
    expect(
      (
        await app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${member.token}` },
        })
      ).status,
    ).toBe(401);
  });

  it('atomically revokes sessions, keys and connected apps on suspension', async () => {
    const admin = await account(true);
    const member = await account();
    const [refresh] = await getDb()
      .insert(refreshTokens)
      .values({ userId: member.id, jti: randomUUID(), expiresAt: new Date(Date.now() + 86400000) })
      .returning();
    const [key] = await getDb()
      .insert(apiKeys)
      .values({ userId: member.id, name: 'fixture', keyHash: randomUUID() })
      .returning();
    const [client] = await getDb()
      .insert(oauthClients)
      .values({
        clientId: `admin-test-${randomUUID()}`,
        name: 'fixture',
        redirectUris: ['https://example.com/callback'],
        allowedScopes: ['gpc:read'],
      })
      .returning();
    if (!refresh || !key || !client) throw new Error('fixture failed');
    clientIds.push(client.id);
    const [grant] = await getDb()
      .insert(oauthGrants)
      .values({
        userId: member.id,
        clientId: client.id,
        scopes: ['gpc:read'],
        resource: 'https://example.com/mcp',
        authVersion: 0,
      })
      .returning();
    if (!grant) throw new Error('fixture failed');
    expect((await action(admin, member.id, 'suspend')).status).toBe(200);
    expect(
      (await getDb().select().from(refreshTokens).where(eq(refreshTokens.id, refresh.id)))[0]
        ?.revokedAt,
    ).not.toBeNull();
    expect(
      (await getDb().select().from(apiKeys).where(eq(apiKeys.id, key.id)))[0]?.revokedAt,
    ).not.toBeNull();
    expect(
      (await getDb().select().from(oauthGrants).where(eq(oauthGrants.id, grant.id)))[0]?.revokedAt,
    ).not.toBeNull();
    expect(
      (await getDb().select().from(users).where(eq(users.id, member.id)))[0]?.authVersion,
    ).toBe(1);
    expect((await action(admin, member.id, 'unsuspend')).status).toBe(200);
    expect(
      (
        await app.request('/api/v1/auth/me', {
          headers: { authorization: `Bearer ${member.token}` },
        })
      ).status,
    ).toBe(401);
  });
});
