/**
 * Characterization tests for src/server/routes/characters.ts.
 *
 * These pin CURRENT behavior (including any surprising bits) ahead of a
 * refactor — they are not a spec for what the routes "should" do.
 *
 * Requires a running Postgres test DB at the URL in testConfig below.
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { type AppConfig, resetConfigCache } from '../config.ts';

const testConfig: AppConfig = {
  environment: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: 'postgres://gurps:gurps@localhost:5432/gurps',
  jwtSecret: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  jwtAccessTtlMinutes: 15,
  jwtRefreshTtlDays: 14,
  apiKeyPepper: 'test-secret-which-is-deliberately-very-long-and-not-a-placeholder',
  corsOrigins: [],
  resendApiKey: undefined,
  resendFromEmail: undefined,
  appBaseUrl: undefined,
};

process.env.DATABASE_URL = testConfig.databaseUrl;
process.env.JWT_SECRET = testConfig.jwtSecret;
process.env.ENVIRONMENT = testConfig.environment;
resetConfigCache();

const app = createApp(testConfig);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

function decodeUserId(accessToken: string): string {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) throw new Error('malformed jwt');
  const json = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
    sub: string;
  };
  return json.sub;
}

async function registerUser(suffix: string) {
  const email = `chars-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email, userId: decodeUserId(body.accessToken) };
}

async function createCampaign(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Campaign ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function addMember(ownerToken: string, campaignId: string, email: string) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function createCharacter(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Character ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/v1/characters', () => {
  it('creates a campaignless character with attribute defaults', async () => {
    const { accessToken, userId } = await registerUser('create-nocamp');
    const character = await createCharacter(accessToken, { name: 'Solo Hero' });
    expect(character.view).toBe('full');
    expect(character.ownerId).toBe(userId);
    expect(character.campaignId).toBeNull();
    expect(character.st).toBe(10);
    expect(character.dx).toBe(10);
    expect(character.iq).toBe(10);
    expect(character.ht).toBe(10);
    expect(character.dismissedWarnings).toEqual([]);
    expect(character.traits).toEqual([]);
    expect(character.combat).toBeNull();
  });

  it('creates a character attached to a campaign the user is a member of', async () => {
    const { accessToken } = await registerUser('create-camp');
    const campaign = await createCampaign(accessToken);
    const character = await createCharacter(accessToken, {
      name: 'Party Member',
      campaignId: campaign.id,
      st: 12,
    });
    expect(character.campaignId).toBe(campaign.id);
    expect(character.st).toBe(12);
  });

  it('403s creating a character attached to a campaign the user does not belong to', async () => {
    const owner = await registerUser('create-owner');
    const outsider = await registerUser('create-outsider');
    const campaign = await createCampaign(owner.accessToken);
    const res = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: jsonHeaders(outsider.accessToken),
      body: JSON.stringify({ name: 'Trespasser', campaignId: campaign.id }),
    });
    expect(res.status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    const res = await app.request('/api/v1/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nobody' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/characters (list)', () => {
  it('only returns characters the user owns or shares a campaign with', async () => {
    const { accessToken, email } = await registerUser('list-scope');
    const outsider = await registerUser('list-scope-outsider');
    const mine = await createCharacter(accessToken, { name: `Mine ${email}` });
    await createCharacter(outsider.accessToken, { name: 'Not mine' });

    const res = await app.request('/api/v1/characters', { headers: bearer(accessToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    const ids = body.map((c) => c.id);
    expect(ids).toContain(mine.id);
    expect(body.every((c) => c.id !== undefined)).toBe(true);
  });

  it('masks ST/DX/IQ/HT to 10 for a fellow member when shareCharacterSheets=false, but not for the owner viewing their own row', async () => {
    const gm = await registerUser('list-mask-gm');
    const owner = await registerUser('list-mask-owner');
    const viewer = await registerUser('list-mask-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Masked One',
      campaignId: campaign.id,
      st: 15,
      dx: 14,
      iq: 13,
      ht: 12,
    });

    // Owner sees their own real stats in the list.
    const ownerListRes = await app.request('/api/v1/characters', {
      headers: bearer(owner.accessToken),
    });
    const ownerList = (await ownerListRes.json()) as Record<string, unknown>[];
    const ownerRow = ownerList.find((c) => c.id === character.id);
    expect(ownerRow?.st).toBe(15);
    expect(ownerRow?.dx).toBe(14);

    // GM sees real stats too.
    const gmListRes = await app.request('/api/v1/characters', { headers: bearer(gm.accessToken) });
    const gmList = (await gmListRes.json()) as Record<string, unknown>[];
    const gmRow = gmList.find((c) => c.id === character.id);
    expect(gmRow?.st).toBe(15);

    // Fellow member sees the row (name, id, etc.) but stats masked to 10.
    const viewerListRes = await app.request('/api/v1/characters', {
      headers: bearer(viewer.accessToken),
    });
    const viewerList = (await viewerListRes.json()) as Record<string, unknown>[];
    const viewerRow = viewerList.find((c) => c.id === character.id);
    expect(viewerRow).toBeDefined();
    expect(viewerRow?.st).toBe(10);
    expect(viewerRow?.dx).toBe(10);
    expect(viewerRow?.iq).toBe(10);
    expect(viewerRow?.ht).toBe(10);
    expect(viewerRow?.name).toBe('Masked One');
  });

  it('does not mask when shareCharacterSheets=true', async () => {
    const gm = await registerUser('list-share-gm');
    const owner = await registerUser('list-share-owner');
    const viewer = await registerUser('list-share-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Open Book',
      campaignId: campaign.id,
      st: 16,
    });

    const viewerListRes = await app.request('/api/v1/characters', {
      headers: bearer(viewer.accessToken),
    });
    const viewerList = (await viewerListRes.json()) as Record<string, unknown>[];
    const viewerRow = viewerList.find((c) => c.id === character.id);
    expect(viewerRow?.st).toBe(16);
  });

  it('401s when unauthenticated', async () => {
    const res = await app.request('/api/v1/characters');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/characters/{id} — access matrix', () => {
  async function buildFixture(shareCharacterSheets: boolean) {
    const gm = await registerUser(`detail-gm-${shareCharacterSheets}`);
    const owner = await registerUser(`detail-owner-${shareCharacterSheets}`);
    const viewer = await registerUser(`detail-viewer-${shareCharacterSheets}`);
    const outsider = await registerUser(`detail-outsider-${shareCharacterSheets}`);
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Fixture Character',
      campaignId: campaign.id,
      st: 17,
    });
    return { gm, owner, viewer, outsider, campaign, character };
  }

  it('owner always gets the full view', async () => {
    const { owner, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(owner.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('campaign GM always gets the full view, even when shareCharacterSheets=false', async () => {
    const { gm, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(gm.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('fellow member gets the full view when shareCharacterSheets=true', async () => {
    const { viewer, character } = await buildFixture(true);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('full');
    expect(body.st).toBe(17);
  });

  it('fellow member gets the minimal view when shareCharacterSheets=false — stats/traits are OMITTED, not masked', async () => {
    const { viewer, character } = await buildFixture(false);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.view).toBe('minimal');
    expect(body.name).toBe('Fixture Character');
    // Unlike the list endpoint (which masks st/dx/iq/ht to 10), the detail
    // minimal view omits these keys entirely.
    expect(body).not.toHaveProperty('st');
    expect(body).not.toHaveProperty('dx');
    expect(body).not.toHaveProperty('traits');
    expect(body).not.toHaveProperty('warnings');
    expect(body).not.toHaveProperty('dismissedWarnings');
  });

  it('non-member is forbidden (403)', async () => {
    const { outsider, character } = await buildFixture(true);
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(outsider.accessToken),
    });
    expect(res.status).toBe(403);
  });

  it('404s for a nonexistent character id', async () => {
    const { owner } = await buildFixture(true);
    const res = await app.request('/api/v1/characters/00000000-0000-0000-0000-000000000000', {
      headers: bearer(owner.accessToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/sync/cursor — minimal-view masking includes tempEffects', () => {
  it("a fellow member with only minimal access gets tempEffects: [] in the cursor row, never the owner's real effects", async () => {
    const gm = await registerUser('cursor-mask-gm');
    const owner = await registerUser('cursor-mask-owner');
    const viewer = await registerUser('cursor-mask-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Secretly Buffed',
      campaignId: campaign.id,
      st: 17,
    });
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({
        tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 4 } }],
      }),
    });

    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ cursors: [{ entityClass: 'character', sinceRevision: 0 }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changes: Array<{ entityId: string; data?: Record<string, unknown> }>;
    };
    const change = body.changes.find((c) => c.entityId === character.id);
    expect(change).toBeDefined();
    expect(change?.data?.tempEffects).toEqual([]);
    expect(change?.data?.st).toBe(10);
  });

  it('the owner still sees their own real tempEffects through the same cursor pull', async () => {
    const gm = await registerUser('cursor-owner-gm');
    const owner = await registerUser('cursor-owner-owner');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Openly Buffed',
      campaignId: campaign.id,
    });
    const tempEffects = [{ id: 'e1', name: 'Might', mods: { st: 4 } }];
    await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ tempEffects }),
    });

    const res = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ cursors: [{ entityClass: 'character', sinceRevision: 0 }] }),
    });
    const body = (await res.json()) as {
      changes: Array<{ entityId: string; data?: Record<string, unknown> }>;
    };
    const change = body.changes.find((c) => c.entityId === character.id);
    expect(change?.data?.tempEffects).toEqual(tempEffects);
  });
});

describe('PATCH /api/v1/characters/{id}', () => {
  it('owner can update attributes and identity fields', async () => {
    const { accessToken } = await registerUser('patch-owner');
    const character = await createCharacter(accessToken, { name: 'Before', st: 10 });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'After', st: 13, playerName: 'Alice' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('After');
    expect(body.st).toBe(13);
    expect(body.playerName).toBe('Alice');
  });

  it('a non-owner campaign member cannot patch (403 "owner only")', async () => {
    const gm = await registerUser('patch-gm');
    const owner = await registerUser('patch-owner2');
    const viewer = await registerUser('patch-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Guarded',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    expect(res.status).toBe(403);
  });

  it('403s when re-pointing campaignId to a campaign the owner does not belong to', async () => {
    const { accessToken } = await registerUser('patch-recamp');
    const other = await registerUser('patch-recamp-other');
    const otherCampaign = await createCampaign(other.accessToken);
    const character = await createCharacter(accessToken, { name: 'Reassign Me' });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ campaignId: otherCampaign.id }),
    });
    expect(res.status).toBe(403);
  });

  it('round-trips tempEffects: PATCH persists the array and folds it into derived stats', async () => {
    const { accessToken } = await registerUser('patch-temp-effects');
    const character = await createCharacter(accessToken, { name: 'Buffed', st: 10 });
    const tempEffects = [
      { id: 'e1', name: 'Might', mods: { st: 2, ht: 1 } },
      { id: 'manual', name: 'Manual adjustment', mods: { hp: 3 } },
    ];
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ tempEffects }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tempEffects).toEqual(tempEffects);
    // st 10 + 2 (Might) = 12; hp = effectiveSt(12) + hpMod(0) + 3 (manual) = 15.
    const derived = body.derived as Record<string, unknown>;
    expect(derived.effectiveSt).toBe(12);
    expect(derived.hp).toBe(15);

    // Re-fetch to confirm it persisted, not just echoed on the PATCH response.
    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.tempEffects).toEqual(tempEffects);
  });

  it('422s on an invalid tempEffects array (per-axis sum out of [-50, 50])', async () => {
    const { accessToken } = await registerUser('patch-temp-effects-invalid');
    const character = await createCharacter(accessToken, { name: 'Overbuffed' });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        tempEffects: [
          { id: 'e1', name: 'A', mods: { st: 30 } },
          { id: 'e2', name: 'B', mods: { st: 30 } },
        ],
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/characters/{id}', () => {
  it('owner can delete; subsequent GET 404s', async () => {
    const { accessToken } = await registerUser('delete-owner');
    const character = await createCharacter(accessToken, { name: 'Doomed' });
    const delRes = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(204);
    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    expect(getRes.status).toBe(404);
  });

  it('non-owner campaign member cannot delete (403)', async () => {
    const gm = await registerUser('delete-gm');
    const owner = await registerUser('delete-owner2');
    const viewer = await registerUser('delete-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Protected',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'DELETE',
      headers: bearer(viewer.accessToken),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/characters/{id}/warnings/dismiss', () => {
  it('dismissing a code adds it to dismissedWarnings and reflects in a follow-up GET', async () => {
    const { accessToken } = await registerUser('warn-dismiss');
    const character = await createCharacter(accessToken, { name: 'Warned' });
    const dismissRes = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'test-warning-code', dismissed: true }),
    });
    expect(dismissRes.status).toBe(200);
    const dismissBody = (await dismissRes.json()) as Record<string, unknown>;
    expect(dismissBody.dismissedWarnings).toContain('test-warning-code');

    const getRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect(getBody.dismissedWarnings).toContain('test-warning-code');
  });

  it('un-dismissing (dismissed: false) removes the code again', async () => {
    const { accessToken } = await registerUser('warn-undismiss');
    const character = await createCharacter(accessToken, { name: 'Warned2' });
    await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'toggle-code', dismissed: true }),
    });
    const restoreRes = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ code: 'toggle-code', dismissed: false }),
    });
    expect(restoreRes.status).toBe(200);
    const body = (await restoreRes.json()) as Record<string, unknown>;
    expect(body.dismissedWarnings).not.toContain('toggle-code');
  });

  it('non-owner cannot dismiss warnings (403)', async () => {
    const gm = await registerUser('warn-gm');
    const owner = await registerUser('warn-owner');
    const viewer = await registerUser('warn-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id as string, owner.email);
    await addMember(gm.accessToken, campaign.id as string, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Not Yours',
      campaignId: campaign.id,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/warnings/dismiss`, {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ code: 'nope', dismissed: true }),
    });
    expect(res.status).toBe(403);
  });
});
