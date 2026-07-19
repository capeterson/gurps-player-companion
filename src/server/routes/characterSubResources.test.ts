/**
 * Characterization tests for src/server/routes/characterSubResources.ts
 * (traits, skills, spells, inventory, combat sub-resources of a character).
 *
 * These pin CURRENT behavior ahead of a refactor — not a spec for what the
 * routes "should" do.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...bearer(token), 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `subres-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
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

// ===================== TRAITS =====================

describe('trait sub-resource CRUD', () => {
  it('POST creates a trait with points defaulting to 0', async () => {
    const { accessToken } = await registerUser('trait-create');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ kind: 'advantage', name: 'Toughness' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      trait: Record<string, unknown>;
      character: Record<string, unknown>;
    };
    expect(body.trait.points).toBe(0);
    expect(body.trait.name).toBe('Toughness');
    expect((body.character.traits as unknown[]).length).toBe(1);
  });

  it('PATCH updates trait fields and returns the refreshed character', async () => {
    const { accessToken } = await registerUser('trait-patch');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ kind: 'disadvantage', name: 'Bad Temper', points: -10 }),
    });
    const { trait } = (await createRes.json()) as { trait: { id: string } };
    const patchRes = await app.request(`/api/v1/characters/${character.id}/traits/${trait.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: -15 }),
    });
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { trait: Record<string, unknown> };
    expect(body.trait.points).toBe(-15);
    expect(body.trait.name).toBe('Bad Temper');
  });

  it('DELETE removes the trait and returns the refreshed character', async () => {
    const { accessToken } = await registerUser('trait-delete');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ kind: 'perk', name: 'Fearless' }),
    });
    const { trait } = (await createRes.json()) as { trait: { id: string } };
    const delRes = await app.request(`/api/v1/characters/${character.id}/traits/${trait.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { traits: unknown[] };
    expect(body.traits).toEqual([]);
  });

  it('non-owner cannot create a trait (403)', async () => {
    const gm = await registerUser('trait-gm');
    const owner = await registerUser('trait-owner');
    const viewer = await registerUser('trait-viewer');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}` }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    for (const member of [owner, viewer]) {
      await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ email: member.email }),
      });
    }
    const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
    const res = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ kind: 'advantage', name: 'Not Yours' }),
    });
    expect(res.status).toBe(403);
  });
});

// ===================== SKILLS =====================

describe('skill sub-resource CRUD', () => {
  it('POST creates a skill with points defaulting to 1, and a computed level', async () => {
    const { accessToken } = await registerUser('skill-create');
    const character = await createCharacter(accessToken, { dx: 12 });
    const res = await app.request(`/api/v1/characters/${character.id}/skills`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Fencing', attribute: 'DX', difficulty: 'A' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { skill: Record<string, unknown> };
    expect(body.skill.points).toBe(1);
    expect(typeof body.skill.level).toBe('number');
  });

  it('PATCH updates a skill', async () => {
    const { accessToken } = await registerUser('skill-patch');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/skills`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Brawling', attribute: 'DX', difficulty: 'E', points: 2 }),
    });
    const { skill } = (await createRes.json()) as { skill: { id: string } };
    const patchRes = await app.request(`/api/v1/characters/${character.id}/skills/${skill.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 8 }),
    });
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { skill: Record<string, unknown> };
    expect(body.skill.points).toBe(8);
  });

  it('DELETE removes a skill', async () => {
    const { accessToken } = await registerUser('skill-delete');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/skills`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Stealth', attribute: 'DX', difficulty: 'A' }),
    });
    const { skill } = (await createRes.json()) as { skill: { id: string } };
    const delRes = await app.request(`/api/v1/characters/${character.id}/skills/${skill.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { skills: unknown[] };
    expect(body.skills).toEqual([]);
  });
});

// ===================== SPELLS =====================

describe('spell sub-resource CRUD', () => {
  it('POST creates a spell with difficulty defaulting to H, points defaulting to 1, baseEnergyCost defaulting to 1', async () => {
    const { accessToken } = await registerUser('spell-create');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/spells`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Fireball' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { spell: Record<string, unknown> };
    expect(body.spell.difficulty).toBe('H');
    expect(body.spell.points).toBe(1);
    expect(body.spell.baseEnergyCost).toBe(1);
  });

  it('PATCH updates a spell', async () => {
    const { accessToken } = await registerUser('spell-patch');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/spells`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Light' }),
    });
    const { spell } = (await createRes.json()) as { spell: { id: string } };
    const patchRes = await app.request(`/api/v1/characters/${character.id}/spells/${spell.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 4 }),
    });
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { spell: Record<string, unknown> };
    expect(body.spell.points).toBe(4);
  });

  it('DELETE removes a spell', async () => {
    const { accessToken } = await registerUser('spell-delete');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/spells`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Darkness' }),
    });
    const { spell } = (await createRes.json()) as { spell: { id: string } };
    const delRes = await app.request(`/api/v1/characters/${character.id}/spells/${spell.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { spells: unknown[] };
    expect(body.spells).toEqual([]);
  });
});

// ===================== INVENTORY =====================

describe('inventory sub-resource CRUD', () => {
  it('POST creates an item; weightLbs/cost/hideawayCapacityLbs come back as numbers (decimal-string DB coercion)', async () => {
    const { accessToken } = await registerUser('inv-create');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Backpack', weightLbs: 2.5, cost: 40, hideawayCapacityLbs: 30 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(body.item.weightLbs).toBe(2.5);
    expect(typeof body.item.weightLbs).toBe('number');
    expect(body.item.cost).toBe(40);
    expect(typeof body.item.cost).toBe('number');
    expect(body.item.hideawayCapacityLbs).toBe(30);
    expect(typeof body.item.hideawayCapacityLbs).toBe('number');
    expect(typeof body.item.effectiveWeightLbs).toBe('number');
  });

  it('POST defaults quantity=1, weightLbs=0, cost=0, hideawayCapacityLbs=0 when omitted', async () => {
    const { accessToken } = await registerUser('inv-defaults');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Bare Item' }),
    });
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(body.item.quantity).toBe(1);
    expect(body.item.weightLbs).toBe(0);
    expect(body.item.cost).toBe(0);
    expect(body.item.hideawayCapacityLbs).toBe(0);
  });

  it('PATCH coerces weightLbs/cost/hideawayCapacityLbs the same way', async () => {
    const { accessToken } = await registerUser('inv-patch-coerce');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Coin Purse' }),
    });
    const { item } = (await createRes.json()) as { item: { id: string } };
    const patchRes = await app.request(`/api/v1/characters/${character.id}/inventory/${item.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ weightLbs: 1.25, cost: 99.99 }),
    });
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as { item: Record<string, unknown> };
    expect(body.item.weightLbs).toBe(1.25);
    expect(body.item.cost).toBe(99.99);
  });

  it('parentId must belong to the same character — rejects a foreign parent (400)', async () => {
    const a = await registerUser('inv-parent-a');
    const b = await registerUser('inv-parent-b');
    const charA = await createCharacter(a.accessToken);
    const charB = await createCharacter(b.accessToken);
    const parentInB = await app.request(`/api/v1/characters/${charB.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(b.accessToken),
      body: JSON.stringify({ name: 'Foreign Container', isContainer: true }),
    });
    const { item: foreignParent } = (await parentInB.json()) as { item: { id: string } };

    const res = await app.request(`/api/v1/characters/${charA.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(a.accessToken),
      body: JSON.stringify({ name: 'Cross-Character Child', parentId: foreignParent.id }),
    });
    expect(res.status).toBe(400);
  });

  it('cycle rejection: an item cannot become its own ancestor via PATCH', async () => {
    const { accessToken } = await registerUser('inv-cycle');
    const character = await createCharacter(accessToken);
    const rootRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Root Container', isContainer: true }),
    });
    const { item: root } = (await rootRes.json()) as { item: { id: string } };
    const childRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Child Container', isContainer: true, parentId: root.id }),
    });
    const { item: child } = (await childRes.json()) as { item: { id: string } };

    // Try to set root's parent to child -> would create a 2-cycle (root -> child -> root).
    const res = await app.request(`/api/v1/characters/${character.id}/inventory/${root.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(res.status).toBe(400);
  });

  it('an item cannot be set as its own parent (400)', async () => {
    const { accessToken } = await registerUser('inv-self-parent');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Lonely Item' }),
    });
    const { item } = (await createRes.json()) as { item: { id: string } };
    const res = await app.request(`/api/v1/characters/${character.id}/inventory/${item.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ parentId: item.id }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE reparents children to the deleted item’s own parent', async () => {
    const { accessToken } = await registerUser('inv-delete-reparent');
    const character = await createCharacter(accessToken);
    const grandparentRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Grandparent', isContainer: true }),
    });
    const { item: grandparent } = (await grandparentRes.json()) as { item: { id: string } };
    const parentRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Parent', isContainer: true, parentId: grandparent.id }),
    });
    const { item: parent } = (await parentRes.json()) as { item: { id: string } };
    const childRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Child', parentId: parent.id }),
    });
    const { item: child } = (await childRes.json()) as { item: { id: string } };

    const delRes = await app.request(`/api/v1/characters/${character.id}/inventory/${parent.id}`, {
      method: 'DELETE',
      headers: bearer(accessToken),
    });
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as { inventory: Record<string, unknown>[] };
    const reparentedChild = body.inventory.find((i) => i.id === child.id);
    expect(reparentedChild?.parentId).toBe(grandparent.id);
  });
});

// ===================== COMBAT =====================

describe('combat state upsert', () => {
  it('first PATCH creates the row with HP/FP maxima derived from ST/HT', async () => {
    const { accessToken } = await registerUser('combat-create');
    const character = await createCharacter(accessToken, { st: 13, ht: 11 });
    const res = await app.request(`/api/v1/characters/${character.id}/combat`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { combat: Record<string, unknown> };
    expect(body.combat.currentHp).toBe(13);
    expect(body.combat.currentFp).toBe(11);
    expect(body.combat.posture).toBe('standing');
    expect(body.combat.conditions).toEqual([]);
    expect(body.combat.maneuver).toBeNull();
  });

  it('a provided currentHp overrides the derived default on first create', async () => {
    const { accessToken } = await registerUser('combat-create-override');
    const character = await createCharacter(accessToken, { st: 13, ht: 11 });
    const res = await app.request(`/api/v1/characters/${character.id}/combat`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ currentHp: 3 }),
    });
    const body = (await res.json()) as { combat: Record<string, unknown> };
    expect(body.combat.currentHp).toBe(3);
    // fp still derived since it wasn't provided.
    expect(body.combat.currentFp).toBe(11);
  });

  it('a second PATCH only updates the provided fields (true upsert, not a fresh derive)', async () => {
    const { accessToken } = await registerUser('combat-upsert-twice');
    const character = await createCharacter(accessToken, { st: 13, ht: 11 });
    await app.request(`/api/v1/characters/${character.id}/combat`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({}),
    });
    const res = await app.request(`/api/v1/characters/${character.id}/combat`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ currentHp: 5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { combat: Record<string, unknown> };
    expect(body.combat.currentHp).toBe(5);
    // currentFp was untouched by the second PATCH, so it keeps the
    // value derived on first create (11), not a freshly re-derived one.
    expect(body.combat.currentFp).toBe(11);
  });

  it('non-owner cannot patch combat state (403)', async () => {
    const gm = await registerUser('combat-gm');
    const owner = await registerUser('combat-owner');
    const viewer = await registerUser('combat-viewer');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(gm.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}` }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    for (const member of [owner, viewer]) {
      await app.request(`/api/v1/campaigns/${campaign.id}/members`, {
        method: 'POST',
        headers: jsonHeaders(gm.accessToken),
        body: JSON.stringify({ email: member.email }),
      });
    }
    const character = await createCharacter(owner.accessToken, { campaignId: campaign.id });
    const res = await app.request(`/api/v1/characters/${character.id}/combat`, {
      method: 'PATCH',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ currentHp: 1 }),
    });
    expect(res.status).toBe(403);
  });
});
