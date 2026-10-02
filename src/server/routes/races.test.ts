import { describe, expect, it } from 'bun:test';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } from '../../shared/syncProtocol.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { createTestActor } from '../testFixtures.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION),
  };
}

async function createCampaign(token: string) {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name: `Race test ${crypto.randomUUID()}` }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function createCharacter(token: string, campaignId: string) {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ name: `Race test character ${crypto.randomUUID()}`, campaignId }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; revision: number; race: unknown };
}

async function createRace(token: string, campaignId: string, body: Record<string, unknown>) {
  const response = await app.request(`/api/v1/campaigns/${campaignId}/library/races`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string; revision: number; key: string };
}

const stonekin = {
  key: 'stonekin',
  sourceLocator: 'synthetic test fixture',
  status: 'complete',
  role: 'definition',
  name: 'Stonekin',
  description: 'A synthetic race used for route regression tests.',
  kind: 'race',
  points: 20,
  attributeModifiers: { st: 1 },
  traits: [{ key: 'stone-skin', name: 'Stone Skin', points: 5 }],
  skills: [{ key: 'masonry', name: 'Masonry', points: 2 }],
  forms: [
    {
      key: 'winged',
      name: 'Winged Stonekin',
      description: null,
      points: 50,
      attributeModifiers: { dx: 1 },
      traits: [],
      skills: [],
      features: ['Has wings.'],
      effects: [],
    },
  ],
};

const lens = {
  key: 'deep-delver',
  sourceLocator: 'synthetic test fixture',
  status: 'complete',
  role: 'definition',
  name: 'Deep Delver',
  kind: 'lens',
  points: 10,
  compatibleRaceKeys: ['stonekin'],
  removesTraits: ['stone-skin'],
  traits: [{ key: 'stone-skin', name: 'Stone Skin (Deep)', points: 8 }],
  attributeModifiers: { iq: 1 },
};

describe('race REST and sync trust boundaries', () => {
  it('rebuilds REST and sync race selections from campaign definitions and keeps owned forms after deletion', async () => {
    const owner = await createTestActor('race-rest-sync-owner');
    const campaign = await createCampaign(owner.accessToken);
    const character = await createCharacter(owner.accessToken, campaign.id);
    const race = await createRace(owner.accessToken, campaign.id, stonekin);
    const addedLens = await createRace(owner.accessToken, campaign.id, lens);

    const cursorResponse = await app.request('/api/v1/sync/cursor', {
      method: 'POST',
      headers: headers(owner.accessToken),
      body: JSON.stringify({
        cursors: [{ entityClass: 'campaign_library_race', sinceRevision: 0 }],
      }),
    });
    expect(cursorResponse.status).toBe(200);
    const cursor = (await cursorResponse.json()) as {
      changes: { entityClass: string; entityId: string; command: string }[];
    };
    expect(cursor.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityClass: 'campaign_library_race',
          entityId: race.id,
          command: 'patch',
        }),
        expect.objectContaining({
          entityClass: 'campaign_library_race',
          entityId: addedLens.id,
          command: 'patch',
        }),
      ]),
    );

    const selection = {
      raceId: race.id,
      variantKey: null,
      lensIds: [addedLens.id],
      formKey: null,
    };
    const forgedRace = {
      selection,
      snapshot: {
        name: 'Forged',
        description: null,
        points: 999,
        attributeModifiers: { st: 100 },
        traits: [],
        skills: [],
        features: [],
        effects: [],
        forms: [],
        sources: [],
      },
    };
    const stalePreviewRace = {
      ...forgedRace,
      snapshot: {
        ...forgedRace.snapshot,
        sources: [
          {
            id: race.id,
            campaignId: campaign.id,
            revision: race.revision - 1,
            key: race.key,
            sourceId: null,
            name: 'Stonekin',
            source: null,
            sourceLocator: 'synthetic test fixture',
          },
        ],
      },
    };
    const staleRest = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: headers(owner.accessToken),
      body: JSON.stringify({ race: stalePreviewRace }),
    });
    expect(staleRest.status).toBe(400);
    expect(await staleRest.json()).toMatchObject({
      error: 'A selected race definition changed; review the current race before applying',
    });
    const staleSync = await app.request('/api/v1/sync/operations', {
      method: 'POST',
      headers: headers(owner.accessToken),
      body: JSON.stringify({
        operations: [
          {
            clientOpId: crypto.randomUUID(),
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            fieldPath: 'race',
            validationVersion: 1,
            attemptedValue: stalePreviewRace,
            prevValue: { selection: {}, snapshot: null },
            baseRevision: character.revision,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(staleSync.status).toBe(200);
    const staleSyncBody = (await staleSync.json()) as {
      outcomes: { status: string; reason?: string }[];
    };
    expect(staleSyncBody.outcomes[0]).toMatchObject({
      status: 'rejected',
      reason: 'A selected race definition changed; review the current race before applying',
    });
    const restPatch = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'PATCH',
      headers: headers(owner.accessToken),
      body: JSON.stringify({ race: forgedRace }),
    });
    expect(restPatch.status).toBe(200);
    const restCharacter = (await restPatch.json()) as {
      revision: number;
      race: {
        snapshot: {
          points: number;
          attributeModifiers: { st?: number; iq?: number };
          traits: { key: string; points: number }[];
        };
      };
    };
    expect(restCharacter.race.snapshot).toMatchObject({
      points: 30,
      attributeModifiers: { st: 1, iq: 1 },
      traits: [{ key: 'stone-skin', points: 8 }],
    });
    expect(restCharacter.race.snapshot.points).not.toBe(999);

    const syncPatch = await app.request('/api/v1/sync/operations', {
      method: 'POST',
      headers: headers(owner.accessToken),
      body: JSON.stringify({
        operations: [
          {
            clientOpId: crypto.randomUUID(),
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            fieldPath: 'race',
            validationVersion: 1,
            attemptedValue: forgedRace,
            prevValue: restCharacter.race,
            baseRevision: restCharacter.revision,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(syncPatch.status).toBe(200);
    const syncResult = (await syncPatch.json()) as { outcomes: { status: string }[] };
    expect(syncResult.outcomes[0]?.status).toBe('applied');

    const selectForm = async (formKey: string | null) =>
      app.request(`/api/v1/characters/${character.id}`, {
        method: 'PATCH',
        headers: headers(owner.accessToken),
        body: JSON.stringify({
          race: {
            selection: { ...selection, formKey },
            snapshot: null,
          },
        }),
      });
    const formPatch = await selectForm('winged');
    expect(formPatch.status).toBe(200);
    const transformed = (await formPatch.json()) as {
      race: {
        snapshot: {
          name: string;
          points: number;
          attributeModifiers: { dx?: number; iq?: number };
          features: string[];
        };
      };
    };
    expect(transformed.race.snapshot).toMatchObject({
      name: expect.stringContaining('Winged Stonekin'),
      points: 30,
      attributeModifiers: { dx: 1, iq: 1 },
      features: ['Has wings.'],
    });

    const deletion = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/races/${race.id}`,
      { method: 'DELETE', headers: headers(owner.accessToken) },
    );
    expect(deletion.status).toBe(204);
    const beforeReturn = await app.request(`/api/v1/characters/${character.id}`, {
      headers: headers(owner.accessToken),
    });
    const beforeReturnJson = await beforeReturn.json();
    expect((beforeReturnJson as { race: { selection: unknown } }).race.selection).toEqual({
      ...selection,
      formKey: 'winged',
    });
    const returnToNatural = await selectForm(null);
    expect(returnToNatural.status, await returnToNatural.clone().text()).toBe(200);
    const natural = (await returnToNatural.json()) as {
      race: {
        snapshot: {
          name: string;
          points: number;
          attributeModifiers: { st?: number; iq?: number };
          sources: { id: string; key: string }[];
        };
      };
    };
    expect(natural.race.snapshot).toMatchObject({
      name: expect.stringContaining('Stonekin'),
      points: 30,
      attributeModifiers: { st: 1, iq: 1 },
      sources: expect.arrayContaining([expect.objectContaining({ id: race.id, key: 'stonekin' })]),
    });
  });

  it('rejects restricted and cross-campaign race selections for members', async () => {
    const owner = await createTestActor('race-visibility-owner');
    const player = await createTestActor('race-visibility-player');
    const campaign = await createCampaign(owner.accessToken);
    const otherCampaign = await createCampaign(owner.accessToken);
    const memberResponse = await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
      method: 'POST',
      headers: headers(owner.accessToken),
      body: JSON.stringify({ email: player.email }),
    });
    expect(memberResponse.status).toBe(200);
    const character = await createCharacter(player.accessToken, campaign.id);
    const restricted = await createRace(owner.accessToken, campaign.id, {
      ...stonekin,
      key: 'restricted-stonekin',
      name: 'Restricted Stonekin',
      restricted: true,
    });
    const foreign = await createRace(owner.accessToken, otherCampaign.id, {
      ...stonekin,
      key: 'foreign-stonekin',
      name: 'Foreign Stonekin',
    });

    for (const raceId of [restricted.id, foreign.id]) {
      const response = await app.request(`/api/v1/characters/${character.id}`, {
        method: 'PATCH',
        headers: headers(player.accessToken),
        body: JSON.stringify({ race: { selection: { raceId, lensIds: [] }, snapshot: null } }),
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain('unavailable');
    }
  });
});
