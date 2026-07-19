/**
 * Tests for `resolveCharacterView`, the consolidated membership-gate +
 * full/minimal decision that replaced `shouldUseMinimalView`
 * (routes/characters.ts) and the inline gate in routes/history.ts.
 *
 * These exercise the function directly against a running Postgres test
 * DB rather than through a specific route, so the access matrix is
 * pinned independent of which route happens to call it.
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { resolveCharacterView } from './characterAccess.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

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
  const email = `char-access-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
): Promise<{ id: string }> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Campaign ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  return (await res.json()) as { id: string };
}

async function addMember(ownerToken: string, campaignId: string, email: string) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
}

async function createCharacter(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; ownerId: string; campaignId: string | null }> {
  const res = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Character ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; ownerId: string; campaignId: string | null };
}

describe('resolveCharacterView', () => {
  it("returns 'full' for the character's owner", async () => {
    const owner = await registerUser('owner');
    const character = await createCharacter(owner.accessToken, { name: 'Solo' });
    const view = await resolveCharacterView(owner.userId, character);
    expect(view).toBe('full');
  });

  it("returns 'forbidden' for a non-owner on a campaignless character", async () => {
    const owner = await registerUser('solo-owner');
    const outsider = await registerUser('solo-outsider');
    const character = await createCharacter(owner.accessToken, { name: 'Solo' });
    const view = await resolveCharacterView(outsider.userId, character);
    expect(view).toBe('forbidden');
  });

  it("returns 'forbidden' for a non-member of the parent campaign", async () => {
    const owner = await registerUser('nonmember-owner');
    const outsider = await registerUser('nonmember-outsider');
    const campaign = await createCampaign(owner.accessToken, { shareCharacterSheets: true });
    const character = await createCharacter(owner.accessToken, {
      name: 'Guarded',
      campaignId: campaign.id,
    });
    const view = await resolveCharacterView(outsider.userId, character);
    expect(view).toBe('forbidden');
  });

  it("returns 'full' for a fellow member when shareCharacterSheets=true", async () => {
    const gm = await registerUser('share-true-gm');
    const owner = await registerUser('share-true-owner');
    const viewer = await registerUser('share-true-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id, owner.email);
    await addMember(gm.accessToken, campaign.id, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Visible',
      campaignId: campaign.id,
    });
    expect(await resolveCharacterView(viewer.userId, character)).toBe('full');
  });

  it("returns 'minimal' for a fellow member when shareCharacterSheets=false", async () => {
    const gm = await registerUser('share-false-gm');
    const owner = await registerUser('share-false-owner');
    const viewer = await registerUser('share-false-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id, owner.email);
    await addMember(gm.accessToken, campaign.id, viewer.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Hidden',
      campaignId: campaign.id,
    });
    expect(await resolveCharacterView(viewer.userId, character)).toBe('minimal');
  });

  it("returns 'full' for the campaign GM even when shareCharacterSheets=false", async () => {
    const gm = await registerUser('gm-full-gm');
    const owner = await registerUser('gm-full-owner');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id, owner.email);
    const character = await createCharacter(owner.accessToken, {
      name: 'Hidden From Everyone But GM',
      campaignId: campaign.id,
    });
    expect(await resolveCharacterView(gm.userId, character)).toBe('full');
  });
});
