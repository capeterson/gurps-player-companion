import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createApp } from '../../app.ts';
import { signAccessToken, signGuestToken } from '../../auth/jwt.ts';
import { resetConfigCache } from '../../config.ts';
import { withAudit } from '../../db/auditContext.ts';
import { closeDb, getDb, runInDbTransaction } from '../../db/client.ts';
import {
  campaignInvitations,
  campaignMemberships,
  campaigns,
  characters,
  previewCampaign,
  users,
} from '../../db/schema.ts';
import { ensureDemoUser } from '../../db/seeds/accounts.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../../testConfig.ts';
import {
  GUEST_ALLOWED_OPERATIONS,
  GuestWriteForbiddenError,
  guestGate,
  isGuestOperationAllowed,
} from './guestAccess.ts';
import { PREVIEW_GUEST_EMAIL, provisionPreviewCampaign } from './provision.ts';

configureIntegrationTestEnvironment();
afterAll(closeDb);
const app = createApp(integrationTestConfig);

let campaignId: string;
let guestToken: string;

/** Run a block in a transaction that is always rolled back. */
async function rolledBack(fn: () => Promise<void>) {
  const rollback = new Error('rollback');
  try {
    await runInDbTransaction(async () => {
      await fn();
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function asGuest(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { authorization: `Bearer ${guestToken}`, ...(init.headers ?? {}) },
  });
}

async function errorOf(response: Response): Promise<string | undefined> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  campaignId = (await provisionPreviewCampaign()).campaignId;
  const response = await app.request('/api/v1/auth/guest', { method: 'POST' });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string; campaignId: string };
  expect(body.campaignId).toBe(campaignId);
  guestToken = body.accessToken;
}, 120_000);

describe('guest preview session', () => {
  it('reports availability and reads the whole preview party', async () => {
    const availability = await app.request('/api/v1/auth/guest');
    expect(await availability.json()).toEqual({ available: true });

    const me = await asGuest('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(PREVIEW_GUEST_EMAIL);

    const campaignList = await asGuest('/api/v1/campaigns');
    expect(campaignList.status).toBe(200);
    const listed = (await campaignList.json()) as { id: string; name: string }[];
    expect(listed.map((campaign) => campaign.id)).toEqual([campaignId]);
  });

  it('pulls full character sheets through the sync cursor', async () => {
    const { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } = await import(
      '../../../shared/syncProtocol.ts'
    );
    const cursor = await asGuest('/api/v1/sync/cursor', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION),
      },
      body: JSON.stringify({
        cursors: [
          { entityClass: 'character', sinceRevision: 0 },
          { entityClass: 'character_skill', sinceRevision: 0 },
        ],
      }),
    });
    expect(cursor.status).toBe(200);
    const body = (await cursor.json()) as {
      changes: { entityClass: string; row?: Record<string, unknown> }[];
      accessible: { campaignIds: string[]; characterIds: string[] };
    };
    expect(body.accessible.campaignIds).toEqual([campaignId]);
    expect(body.accessible.characterIds).toHaveLength(6);
    expect(body.changes.some((change) => change.entityClass === 'character_skill')).toBe(true);
  });

  it('blocks writes, credentials, agents and the push channel', async () => {
    const [character] = await getDb()
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.campaignId, campaignId));
    if (!character) throw new Error('preview character missing');
    const json = { 'content-type': 'application/json' };
    const attempts: [string, RequestInit][] = [
      [`/api/v1/characters/${character.id}`, { method: 'PATCH', headers: json, body: '{}' }],
      ['/api/v1/characters', { method: 'POST', headers: json, body: '{"name":"x"}' }],
      ['/api/v1/sync/operations', { method: 'POST', headers: json, body: '{"operations":[]}' }],
      [`/api/v1/campaigns/${campaignId}/log`, { method: 'POST', headers: json, body: '{}' }],
      ['/api/v1/auth/password', { method: 'POST', headers: json, body: '{}' }],
      ['/api/v1/auth/passkeys/register/options', { method: 'POST', headers: json, body: '{}' }],
      ['/api/v1/auth/api-keys', { method: 'POST', headers: json, body: '{"name":"x"}' }],
      ['/api/v1/auth/preferences', { method: 'GET' }],
      ['/api/v1/auth/notification-preferences', { method: 'GET' }],
      ['/api/v1/oauth/grants', { method: 'GET' }],
      ['/api/v1/media/uploads', { method: 'POST', headers: json, body: '{}' }],
      ['/mcp', { method: 'POST', headers: json, body: '{}' }],
      ['/mcp', { method: 'GET' }],
      ['/api/v1/admin/users', { method: 'GET' }],
    ];
    for (const [path, init] of attempts) {
      const response = await asGuest(path, init);
      expect({ path, method: init.method, status: response.status }).toEqual({
        path,
        method: init.method,
        status: 403,
      });
      expect(await errorOf(response)).toBe('guest_read_only');
    }

    const socket = await app.request(`/api/v1/sync/ws?token=${encodeURIComponent(guestToken)}`, {
      headers: { upgrade: 'websocket' },
    });
    expect(socket.status).toBe(403);
  });

  it('sends a guest token to every API operation and refuses all but the allow-list', async () => {
    const document = app.getOpenAPIDocument({
      openapi: '3.0.0',
      info: { title: 'GURPS Player Companion API', version: '0.1.0' },
    }) as unknown as { paths: Record<string, Record<string, unknown>> };
    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map((method) => ({ method: method.toUpperCase(), path })),
    );

    // Every allow-list entry names a real read operation.
    for (const allowed of GUEST_ALLOWED_OPERATIONS) {
      expect(operations).toContainEqual(allowed);
      expect(
        allowed.method === 'GET' ||
          `${allowed.method} ${allowed.path}` === 'POST /api/v1/sync/cursor',
      ).toBe(true);
    }

    for (const operation of operations) {
      const concrete = operation.path.replace(/\{[^}]+\}/g, randomUUID());
      const response = await asGuest(concrete, {
        method: operation.method,
        ...(operation.method === 'GET'
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: '{}' }),
      });
      const error = await errorOf(response);
      const allowed = isGuestOperationAllowed(operation.method, concrete);
      expect({ ...operation, refused: error === 'guest_read_only' }).toEqual({
        ...operation,
        refused: !allowed,
      });
    }
  });

  it('refuses audited writes even on an allowed read route', async () => {
    const probe = new Hono();
    probe.use('*', guestGate);
    probe.get('/api/v1/campaigns', async (c) => {
      try {
        await withAudit(randomUUID(), undefined, async () => undefined);
        return c.json({ wrote: true });
      } catch (error) {
        return c.json({ refused: error instanceof GuestWriteForbiddenError });
      }
    });
    const response = await probe.request('/api/v1/campaigns', {
      headers: { authorization: `Bearer ${guestToken}` },
    });
    expect(await response.json()).toEqual({ refused: true });
  });

  it('rejects guest tokens once preview mode is turned off', async () => {
    process.env.PREVIEW_MODE_ENABLED = 'false';
    resetConfigCache();
    try {
      expect((await asGuest('/api/v1/auth/me')).status).toBe(401);
      expect((await app.request('/api/v1/auth/guest', { method: 'POST' })).status).toBe(404);
      expect(await (await app.request('/api/v1/auth/guest')).json()).toEqual({ available: false });
    } finally {
      process.env.PREVIEW_MODE_ENABLED = 'true';
      resetConfigCache();
    }
    expect((await asGuest('/api/v1/auth/me')).status).toBe(200);
  });

  it('revokes outstanding guest tokens when the guest account auth version advances', async () => {
    await rolledBack(async () => {
      const [guest] = await getDb()
        .select()
        .from(users)
        .where(eq(users.email, PREVIEW_GUEST_EMAIL));
      if (!guest) throw new Error('guest missing');
      const stale = (await signGuestToken(guest.id, guest.authVersion)).token;
      await getDb()
        .update(users)
        .set({ authVersion: guest.authVersion + 1 })
        .where(eq(users.id, guest.id));
      const response = await app.request('/api/v1/auth/me', {
        headers: { authorization: `Bearer ${stale}` },
      });
      expect(response.status).toBe(401);
    });
  });
});

describe('preview campaign protection', () => {
  it('refuses application writes to preview rows from any actor', async () => {
    const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new Error('preview campaign missing');
    const attempts: Array<() => Promise<unknown>> = [
      () =>
        withAudit(campaign.ownerId, undefined, (tx) =>
          tx.update(campaigns).set({ name: 'Renamed' }).where(eq(campaigns.id, campaignId)),
        ),
      () =>
        withAudit(campaign.ownerId, undefined, (tx) =>
          tx
            .update(characters)
            .set({ name: 'Renamed' })
            .where(eq(characters.campaignId, campaignId)),
        ),
      () =>
        withAudit(campaign.ownerId, undefined, (tx) =>
          tx.delete(campaignMemberships).where(eq(campaignMemberships.campaignId, campaignId)),
        ),
      () =>
        withAudit(campaign.ownerId, undefined, async (tx) => {
          const [mine] = await tx
            .select({ id: characters.id })
            .from(characters)
            .where(eq(characters.campaignId, campaignId));
          await tx.execute(
            sql`update character_skills set points = points + 1 where character_id = ${mine?.id}`,
          );
        }),
    ];
    for (const attempt of attempts) {
      await rolledBack(async () => {
        await expect(attempt()).rejects.toThrow('the preview campaign is read-only');
      });
    }
  });

  it('keeps the preview owner from editing it through the API', async () => {
    const [campaign] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) throw new Error('preview campaign missing');
    const { token } = await signAccessToken(campaign.ownerId);
    const response = await app.request(`/api/v1/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed by owner' }),
    });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe('preview_read_only');
  });

  it('keeps system accounts out of every other campaign and every sign-in path', async () => {
    const owner = await ensureDemoUser(`preview-owner-${randomUUID()}@example.invalid`, 'Owner');
    const { token } = await signAccessToken(owner.id, owner.authVersion);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const created = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: `Private ${randomUUID()}` }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const addGuest = await app.request(`/api/v1/campaigns/${id}/members`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ email: PREVIEW_GUEST_EMAIL }),
    });
    expect(addGuest.status).toBe(404);
    const [guest] = await getDb().select().from(users).where(eq(users.email, PREVIEW_GUEST_EMAIL));
    if (!guest) throw new Error('guest missing');
    const inviteByEmail = await app.request(`/api/v1/campaigns/${id}/invitations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ handle: PREVIEW_GUEST_EMAIL }),
    });
    expect(inviteByEmail.status).toBe(404);
    // The guest's display name never resolves to the guest, even if another account shares it.
    await app.request(`/api/v1/campaigns/${id}/invitations`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ handle: guest.displayName }),
    });
    const guestInvites = await getDb()
      .select({ id: campaignInvitations.id })
      .from(campaignInvitations)
      .where(eq(campaignInvitations.inviteeId, guest.id));
    expect(guestInvites).toHaveLength(0);
    await rolledBack(async () => {
      await expect(
        withAudit(owner.id, undefined, (tx) =>
          tx
            .insert(campaignMemberships)
            .values({ campaignId: id, userId: guest.id, role: 'member' }),
        ),
      ).rejects.toThrow('system preview accounts cannot join');
    });

    const login = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: PREVIEW_GUEST_EMAIL, password: '!preview-system-account' }),
    });
    expect(login.status).toBe(401);
    const register = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `someone-${randomUUID()}@preview.invalid`,
        password: 'LongEnoughPassword1!',
        displayName: 'Squatter',
      }),
    });
    expect(register.status).toBe(409);
  });

  it('is idempotent and rebuilds when forced', async () => {
    expect(await provisionPreviewCampaign()).toEqual({ campaignId, rebuilt: false });
    await rolledBack(async () => {
      const rebuilt = await provisionPreviewCampaign({ force: true });
      expect(rebuilt.rebuilt).toBe(true);
      expect(rebuilt.campaignId).not.toBe(campaignId);
      const [old] = await getDb().select().from(campaigns).where(eq(campaigns.id, campaignId));
      expect(old).toBeUndefined();
      const [pointer] = await getDb().select().from(previewCampaign);
      expect(pointer?.campaignId).toBe(rebuilt.campaignId);
      const party = await getDb()
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.campaignId, rebuilt.campaignId));
      expect(party).toHaveLength(6);
    });
  }, 120_000);
});
