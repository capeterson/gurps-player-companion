/** Integration coverage for the privacy projection in encounters.ts. */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { type AppConfig, resetConfigCache } from '../config.ts';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://gurps:gurps@localhost:5432/gurps';

const testConfig: AppConfig = {
  environment: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: testDatabaseUrl,
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

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `encounter-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  expect(response.status).toBe(201);
  return { email, accessToken: ((await response.json()) as { accessToken: string }).accessToken };
}

async function createCampaign(accessToken: string) {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Encounter campaign ${Date.now()}-${Math.random()}` }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function addMember(accessToken: string, campaignId: string, email: string) {
  const response = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ email }),
  });
  expect(response.status).toBe(200);
}

async function createCharacter(accessToken: string, campaignId: string, name: string) {
  const response = await app.request('/api/v1/characters', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ campaignId, name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

describe('encounter member projection', () => {
  it('persists full NPC edits, order-key reslots, and ended encounter state', async () => {
    const gm = await registerUser('edit-gm');
    const campaign = await createCampaign(gm.accessToken);
    const createdResponse = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        name: 'Final stand',
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      combatants: { id: string }[];
    };
    const combatantId = created.combatants[0]?.id;
    if (!combatantId) throw new Error('missing NPC');

    const editedResponse = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${created.id}/combatants/${combatantId}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          name: 'Hidden orc',
          basicSpeed: 6.25,
          dx: 12,
          maxHp: 14,
          currentHp: 9,
          move: 5,
          dodge: 8,
          dr: 3,
          hiddenFromPlayers: true,
          notes: 'Behind the wall',
          maneuver: 'Wait',
          conditions: ['stunned'],
          active: false,
          orderKey: 27.5,
        }),
      },
    );
    expect(editedResponse.status).toBe(200);
    expect(await editedResponse.json()).toMatchObject({
      name: 'Hidden orc',
      basicSpeed: 6.25,
      dx: 12,
      maxHp: 14,
      currentHp: 9,
      move: 5,
      dodge: 8,
      dr: 3,
      hiddenFromPlayers: true,
      notes: 'Behind the wall',
      maneuver: 'Wait',
      conditions: ['stunned'],
      active: false,
      orderKey: 27.5,
    });

    const endedResponse = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ status: 'ended' }),
      },
    );
    expect(endedResponse.status).toBe(200);
    expect(await endedResponse.json()).toMatchObject({ status: 'ended' });
    const listResponse = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      headers: { Authorization: `Bearer ${gm.accessToken}` },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, status: 'ended' })]),
    );
  });

  it('uses character ownership and masks hidden combatant data without clearing active turn state', async () => {
    const gm = await registerUser('gm');
    const otherPlayer = await registerUser('other-player');
    const viewer = await registerUser('viewer');
    const campaign = await createCampaign(gm.accessToken);
    await addMember(gm.accessToken, campaign.id, otherPlayer.email);
    await addMember(gm.accessToken, campaign.id, viewer.email);
    const otherCharacter = await createCharacter(otherPlayer.accessToken, campaign.id, 'Other PC');
    const viewerCharacter = await createCharacter(viewer.accessToken, campaign.id, 'Viewer PC');

    const createdResponse = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        name: 'Ambush',
        combatants: [
          { kind: 'pc', characterId: otherCharacter.id },
          { kind: 'pc', characterId: viewerCharacter.id },
          { kind: 'npc', name: 'Visible guard', basicSpeed: 5, dx: 10, maxHp: 10 },
          {
            kind: 'npc',
            name: 'Hidden assassin',
            basicSpeed: 7,
            dx: 14,
            maxHp: 8,
            hiddenFromPlayers: true,
          },
        ],
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      combatants: { id: string; name: string }[];
    };
    const combatantId = (name: string) => {
      const combatant = created.combatants.find((row) => row.name === name);
      if (!combatant) throw new Error(`missing ${name}`);
      return combatant.id;
    };
    const visibleGuardId = combatantId('Visible guard');
    const hiddenAssassinId = combatantId('Hidden assassin');

    for (const body of [
      {
        targetCombatantId: visibleGuardId,
        casterCombatantId: hiddenAssassinId,
        name: 'Concealed hex',
        duration: { unit: 'rounds', amount: 1 },
      },
      {
        targetCombatantId: hiddenAssassinId,
        casterCombatantId: visibleGuardId,
        name: 'Hidden target effect',
        duration: { unit: 'rounds', amount: 1 },
      },
    ]) {
      const response = await app.request(
        `/api/v1/campaigns/${campaign.id}/encounters/${created.id}/effects`,
        { method: 'POST', headers: jsonHeaders(gm.accessToken), body: JSON.stringify(body) },
      );
      expect(response.status).toBe(201);
    }

    const activeResponse = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ activeCombatantId: hiddenAssassinId }),
      },
    );
    expect(activeResponse.status).toBe(200);

    const response = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${created.id}`,
      {
        headers: { Authorization: `Bearer ${viewer.accessToken}` },
      },
    );
    expect(response.status).toBe(200);
    const projected = (await response.json()) as {
      activeCombatantId: string | null;
      combatants: {
        id: string;
        characterId: string | null;
        name: string;
        basicSpeed: number | null;
        dx: number | null;
      }[];
      effects: { targetCombatantId: string; casterCombatantId: string | null; name: string }[];
    };

    expect(projected.activeCombatantId).toBe(hiddenAssassinId);
    expect(projected.combatants.map((row) => row.name)).not.toContain('Hidden assassin');
    const ownPc = projected.combatants.find((row) => row.characterId === viewerCharacter.id);
    const foreignPc = projected.combatants.find((row) => row.characterId === otherCharacter.id);
    expect(ownPc?.basicSpeed).toBe(5);
    expect(ownPc?.dx).toBe(10);
    expect(foreignPc?.basicSpeed).toBeNull();
    expect(foreignPc?.dx).toBeNull();
    expect(projected.effects).toHaveLength(1);
    expect(projected.effects[0]).toMatchObject({
      targetCombatantId: visibleGuardId,
      casterCombatantId: null,
      name: 'Concealed hex',
    });
  });
});
