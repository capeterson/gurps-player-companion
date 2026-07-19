/** Integration coverage for the privacy projection in encounters.ts. */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

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

async function createCampaign(accessToken: string, overrides: Record<string, unknown> = {}) {
  const response = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      name: `Encounter campaign ${Date.now()}-${Math.random()}`,
      ...overrides,
    }),
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

async function getUserId(accessToken: string) {
  const response = await app.request('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function promoteToManager(ownerToken: string, campaignId: string, userId: string) {
  const response = await app.request(`/api/v1/campaigns/${campaignId}/members/${userId}`, {
    method: 'PATCH',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ role: 'manager' }),
  });
  expect(response.status).toBe(200);
}

async function updateCampaign(
  ownerToken: string,
  campaignId: string,
  body: Record<string, unknown>,
) {
  const response = await app.request(`/api/v1/campaigns/${campaignId}`, {
    method: 'PATCH',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify(body),
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

async function addInventory(accessToken: string, characterId: string, weightLbs: number) {
  const response = await app.request(`/api/v1/characters/${characterId}/inventory`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: 'Load', weightLbs, worn: true }),
  });
  expect(response.status).toBe(201);
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
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
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
        maxHp: number | null;
        currentHp: number | null;
        move: number | null;
        dodge: number | null;
        maneuver: string | null;
        conditions: string[];
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
    expect(foreignPc).toMatchObject({
      maxHp: null,
      currentHp: null,
      move: null,
      dodge: null,
      maneuver: null,
      conditions: [],
    });
    expect(projected.effects).toHaveLength(1);
    expect(projected.effects[0]).toMatchObject({
      targetCombatantId: visibleGuardId,
      casterCombatantId: null,
      name: 'Concealed hex',
    });
  });

  it('does not mask another PC initiative when sheets are shared', async () => {
    const gm = await registerUser('shared-gm');
    const player = await registerUser('shared-player');
    const viewer = await registerUser('shared-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: true });
    await addMember(gm.accessToken, campaign.id, player.email);
    await addMember(gm.accessToken, campaign.id, viewer.email);
    const character = await createCharacter(player.accessToken, campaign.id, 'Shared PC');
    const response = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    expect(response.status).toBe(201);
    const encounter = (await response.json()) as { id: string };

    const projected = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      { headers: { Authorization: `Bearer ${viewer.accessToken}` } },
    );
    expect(projected.status).toBe(200);
    expect(await projected.json()).toMatchObject({
      combatants: [
        expect.objectContaining({
          characterId: character.id,
          basicSpeed: 5,
          dx: 10,
          maxHp: 10,
          currentHp: 10,
          move: 5,
          dodge: 8,
          conditions: [],
        }),
      ],
    });
  });

  it('validates encounter active combatants and applies versioned active turn advances', async () => {
    const gm = await registerUser('advance-gm');
    const campaign = await createCampaign(gm.accessToken);
    const create = (name: string) =>
      app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          name,
          combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
        }),
      });
    const secondResponse = await create('Second');
    const second = (await secondResponse.json()) as { id: string; combatants: { id: string }[] };
    const endedSecond = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${second.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ status: 'ended' }),
      },
    );
    expect(endedSecond.status).toBe(200);
    const firstResponse = await create('First');
    const first = (await firstResponse.json()) as {
      id: string;
      version: number;
      combatants: { id: string }[];
    };
    const foreignCombatantId = second.combatants[0]?.id;
    if (!foreignCombatantId) throw new Error('missing foreign combatant');

    const invalidActive = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${first.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ activeCombatantId: foreignCombatantId }),
      },
    );
    expect(invalidActive.status).toBe(422);

    const invalidHp = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${first.id}/combatants/${first.combatants[0]?.id}`,
      { method: 'PATCH', headers: jsonHeaders(gm.accessToken), body: JSON.stringify({ maxHp: 0 }) },
    );
    expect(invalidHp.status).toBe(422);

    const advanceBody = {
      direction: 'next',
      expectedRound: 1,
      expectedActiveCombatantId: null,
      expectedVersion: first.version,
    };
    const advanced = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${first.id}/advance`,
      {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify(advanceBody),
      },
    );
    expect(advanced.status).toBe(200);
    expect((await advanced.json()) as { version: number }).toMatchObject({
      version: first.version + 1,
    });

    const staleAdvance = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${first.id}/advance`,
      { method: 'POST', headers: jsonHeaders(gm.accessToken), body: JSON.stringify(advanceBody) },
    );
    expect(staleAdvance.status).toBe(409);

    const end = await app.request(`/api/v1/campaigns/${campaign.id}/encounters/${first.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ status: 'ended' }),
    });
    const ended = (await end.json()) as { version: number };
    const endedAdvance = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${first.id}/advance`,
      {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ ...advanceBody, expectedVersion: ended.version }),
      },
    );
    expect(endedAdvance.status).toBe(409);
  });

  it('captures PC Move and Dodge after encumbrance', async () => {
    const gm = await registerUser('encumbered-pc-gm');
    const campaign = await createCampaign(gm.accessToken);
    const character = await createCharacter(gm.accessToken, campaign.id, 'Loaded PC');
    // Default ST 10 has BL 20; just above 10x BL leaves the PC unable to move.
    await addInventory(gm.accessToken, character.id, 201);

    const response = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      combatants: [expect.objectContaining({ move: 0, dodge: 4 })],
    });
  });

  it('rejects duplicate PCs in encounter creation and combatant additions', async () => {
    const gm = await registerUser('duplicate-pc-gm');
    const campaign = await createCampaign(gm.accessToken);
    const character = await createCharacter(gm.accessToken, campaign.id, 'Duplicate PC');
    const duplicateCreate = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [
          { kind: 'pc', characterId: character.id },
          { kind: 'pc', characterId: character.id },
        ],
      }),
    });
    expect(duplicateCreate.status).toBe(422);

    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    expect(created.status).toBe(201);
    const encounter = (await created.json()) as { id: string };
    const duplicateAdd = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/combatants`,
      {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ kind: 'pc', characterId: character.id }),
      },
    );
    expect(duplicateAdd.status).toBe(422);
  });

  it('clears the active combatant and increments the version when it is deleted', async () => {
    const gm = await registerUser('delete-active-gm');
    const campaign = await createCampaign(gm.accessToken);
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    const encounter = (await created.json()) as {
      id: string;
      version: number;
      combatants: { id: string }[];
    };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');

    const activated = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ activeCombatantId: combatantId }),
      },
    );
    expect(activated.status).toBe(200);
    const active = (await activated.json()) as { version: number };

    const deleted = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/combatants/${combatantId}`,
      { method: 'DELETE', headers: jsonHeaders(gm.accessToken) },
    );
    expect(deleted.status).toBe(204);
    const current = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      {
        headers: { Authorization: `Bearer ${gm.accessToken}` },
      },
    );
    expect(await current.json()).toMatchObject({
      activeCombatantId: null,
      version: active.version + 1,
      combatants: [],
    });
  });

  it('retains a PC combatant when its character is deleted', async () => {
    const gm = await registerUser('deleted-pc-gm');
    const campaign = await createCampaign(gm.accessToken);
    const character = await createCharacter(gm.accessToken, campaign.id, 'Departed PC');
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    const encounter = (await created.json()) as { id: string };

    const deleted = await app.request(`/api/v1/characters/${character.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(gm.accessToken),
    });
    expect(deleted.status).toBe(204);

    const projected = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      {
        headers: { Authorization: `Bearer ${gm.accessToken}` },
      },
    );
    expect(await projected.json()).toMatchObject({
      combatants: [expect.objectContaining({ kind: 'pc', characterId: null, name: 'Departed PC' })],
    });
  });

  it('masks foreign PC combat from a manager unless GM character editing is enabled', async () => {
    const gm = await registerUser('mask-gm');
    const player = await registerUser('mask-player');
    const manager = await registerUser('mask-manager');
    const campaign = await createCampaign(gm.accessToken, {
      shareCharacterSheets: false,
      allowGmCharacterEditing: false,
    });
    await addMember(gm.accessToken, campaign.id, player.email);
    await addMember(gm.accessToken, campaign.id, manager.email);
    await promoteToManager(gm.accessToken, campaign.id, await getUserId(manager.accessToken));
    const character = await createCharacter(player.accessToken, campaign.id, 'Player PC');

    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    expect(created.status).toBe(201);
    const encounter = (await created.json()) as { id: string };

    const masked = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      { headers: { Authorization: `Bearer ${manager.accessToken}` } },
    );
    expect(masked.status).toBe(200);
    expect((await masked.json()) as unknown).toMatchObject({
      combatants: [
        expect.objectContaining({
          characterId: character.id,
          basicSpeed: null,
          dx: null,
          maxHp: null,
          currentHp: null,
          move: null,
          dodge: null,
          conditions: [],
        }),
      ],
    });

    await updateCampaign(gm.accessToken, campaign.id, { allowGmCharacterEditing: true });
    const visible = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      { headers: { Authorization: `Bearer ${manager.accessToken}` } },
    );
    expect(visible.status).toBe(200);
    expect((await visible.json()) as unknown).toMatchObject({
      combatants: [
        expect.objectContaining({ characterId: character.id, basicSpeed: 5, dx: 10, maxHp: 10 }),
      ],
    });
  });

  it('clears active turn state when the acting combatant is deactivated', async () => {
    const gm = await registerUser('deactivate-gm');
    const campaign = await createCampaign(gm.accessToken);
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    const encounter = (await created.json()) as { id: string; combatants: { id: string }[] };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');

    const activated = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ activeCombatantId: combatantId }),
      },
    );
    const active = (await activated.json()) as { version: number };

    const deactivated = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/combatants/${combatantId}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ active: false }),
      },
    );
    expect(deactivated.status).toBe(200);

    const current = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      { headers: { Authorization: `Bearer ${gm.accessToken}` } },
    );
    expect(await current.json()).toMatchObject({
      activeCombatantId: null,
      version: active.version + 1,
    });
  });

  it('rejects over-long maneuver edits and out-of-range effect round markers', async () => {
    const gm = await registerUser('validation-gm');
    const campaign = await createCampaign(gm.accessToken);
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    const encounter = (await created.json()) as { id: string; combatants: { id: string }[] };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');

    const longManeuver = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/combatants/${combatantId}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ maneuver: 'x'.repeat(81) }),
      },
    );
    expect(longManeuver.status).toBe(422);

    const effectResponse = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/effects`,
      {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          targetCombatantId: combatantId,
          name: 'Bless',
          duration: { unit: 'rounds', amount: 5 },
        }),
      },
    );
    expect(effectResponse.status).toBe(201);
    const effect = (await effectResponse.json()) as { id: string };
    const patchEffect = (body: Record<string, unknown>) =>
      app.request(
        `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/effects/${effect.id}`,
        { method: 'PATCH', headers: jsonHeaders(gm.accessToken), body: JSON.stringify(body) },
      );

    expect((await patchEffect({ lastMaintainedRound: 0 })).status).toBe(422);
    expect((await patchEffect({ lastMaintainedRound: 5 })).status).toBe(422);
    expect((await patchEffect({ expiryAcknowledgedAtRound: 99 })).status).toBe(422);
    expect((await patchEffect({ lastMaintainedRound: 1 })).status).toBe(200);
  });

  it('rejects setting an inactive combatant as the active turn token', async () => {
    const gm = await registerUser('inactive-active-gm');
    const campaign = await createCampaign(gm.accessToken);
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [
          { kind: 'npc', name: 'Sleeper', basicSpeed: 5, dx: 10, maxHp: 10, active: false },
        ],
      }),
    });
    const encounter = (await created.json()) as { id: string; combatants: { id: string }[] };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');

    const response = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ activeCombatantId: combatantId }),
      },
    );
    expect(response.status).toBe(422);
  });

  it('rejects over-long linked effect fields', async () => {
    const gm = await registerUser('linked-length-gm');
    const campaign = await createCampaign(gm.accessToken);
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({
        combatants: [{ kind: 'npc', name: 'Orc', basicSpeed: 5, dx: 10, maxHp: 10 }],
      }),
    });
    const encounter = (await created.json()) as { id: string; combatants: { id: string }[] };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');
    const createEffect = (body: Record<string, unknown>) =>
      app.request(`/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/effects`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          targetCombatantId: combatantId,
          name: 'Hex',
          duration: { unit: 'rounds', amount: 1 },
          ...body,
        }),
      });

    expect((await createEffect({ linkedCondition: 'x'.repeat(81) })).status).toBe(422);
    expect((await createEffect({ linkedTempEffectId: 'y'.repeat(121) })).status).toBe(422);
  });

  it('masks linked effect fields for a minimal PC viewer', async () => {
    const gm = await registerUser('linked-mask-gm');
    const player = await registerUser('linked-mask-player');
    const viewer = await registerUser('linked-mask-viewer');
    const campaign = await createCampaign(gm.accessToken, { shareCharacterSheets: false });
    await addMember(gm.accessToken, campaign.id, player.email);
    await addMember(gm.accessToken, campaign.id, viewer.email);
    const character = await createCharacter(player.accessToken, campaign.id, 'Player PC');
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [{ kind: 'pc', characterId: character.id }] }),
    });
    const encounter = (await created.json()) as { id: string; combatants: { id: string }[] };
    const combatantId = encounter.combatants[0]?.id;
    if (!combatantId) throw new Error('missing combatant');
    const effect = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/effects`,
      {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({
          targetCombatantId: combatantId,
          name: 'Hex',
          duration: { unit: 'rounds', amount: 1 },
          linkedCondition: 'stunned',
        }),
      },
    );
    expect(effect.status).toBe(201);

    const projected = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}`,
      { headers: { Authorization: `Bearer ${viewer.accessToken}` } },
    );
    expect(projected.status).toBe(200);
    const body = (await projected.json()) as {
      combatants: { conditions: string[] }[];
      effects: { linkedCondition: string | null; linkedTempEffectId: string | null }[];
    };
    expect(body.combatants[0]?.conditions).toEqual([]);
    expect(body.effects[0]).toMatchObject({ linkedCondition: null, linkedTempEffectId: null });
  });

  it('masks PC combat in combatant mutation responses for a manager without GM editing', async () => {
    const gm = await registerUser('mutation-mask-gm');
    const player = await registerUser('mutation-mask-player');
    const manager = await registerUser('mutation-mask-manager');
    const campaign = await createCampaign(gm.accessToken, {
      shareCharacterSheets: false,
      allowGmCharacterEditing: false,
    });
    await addMember(gm.accessToken, campaign.id, player.email);
    await addMember(gm.accessToken, campaign.id, manager.email);
    await promoteToManager(gm.accessToken, campaign.id, await getUserId(manager.accessToken));
    const character = await createCharacter(player.accessToken, campaign.id, 'Player PC');
    const created = await app.request(`/api/v1/campaigns/${campaign.id}/encounters`, {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ combatants: [] }),
    });
    const encounter = (await created.json()) as { id: string };

    const added = await app.request(
      `/api/v1/campaigns/${campaign.id}/encounters/${encounter.id}/combatants`,
      {
        method: 'POST',
        headers: jsonHeaders(manager.accessToken),
        body: JSON.stringify({ kind: 'pc', characterId: character.id }),
      },
    );
    expect(added.status).toBe(201);
    expect((await added.json()) as unknown).toMatchObject({
      characterId: character.id,
      basicSpeed: null,
      dx: null,
      maxHp: null,
      currentHp: null,
      move: null,
      dodge: null,
      conditions: [],
    });
  });
});
