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

  it('POST/PATCH round-trip the enchantments list; explicit [] clears it', async () => {
    const { accessToken } = await registerUser('inv-enchant');
    const character = await createCharacter(accessToken);
    const enchantments = [
      { spellName: 'Fortify', spellLevel: 18, category: 'Fortify +3' },
      { spellName: 'Deflect', category: 'Deflect +2' },
    ];
    const createRes = await app.request(`/api/v1/characters/${character.id}/inventory`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Phoenix Cloak', enchantments }),
    });
    expect(createRes.status).toBe(201);
    const { item } = (await createRes.json()) as { item: Record<string, unknown> };
    expect(item.enchantments).toEqual(enchantments);

    // A patch that omits the field preserves the list.
    const touchRes = await app.request(`/api/v1/characters/${character.id}/inventory/${item.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ notes: 'woven phoenix feathers' }),
    });
    expect(touchRes.status).toBe(200);
    const touched = (await touchRes.json()) as { item: Record<string, unknown> };
    expect(touched.item.enchantments).toEqual(enchantments);
    expect(touched.item.notes).toBe('woven phoenix feathers');

    // An explicit empty array clears it.
    const clearRes = await app.request(`/api/v1/characters/${character.id}/inventory/${item.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ enchantments: [] }),
    });
    expect(clearRes.status).toBe(200);
    const cleared = (await clearRes.json()) as { item: Record<string, unknown> };
    expect(cleared.item.enchantments).toEqual([]);

    // Over-length / blank-name entries are rejected (422).
    const badRes = await app.request(`/api/v1/characters/${character.id}/inventory/${item.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ enchantments: [{ spellName: '' }] }),
    });
    expect(badRes.status).toBe(422);
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

// ===================== LANGUAGES =====================

describe('language sub-resource CRUD', () => {
  it('POST creates a language with fluency defaults and refreshes the point ledger', async () => {
    const { accessToken } = await registerUser('lang-create');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Latin', spokenFluency: 'accented', points: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      language: Record<string, unknown>;
      character: { languages: unknown[]; points: Record<string, number> };
    };
    expect(body.language.name).toBe('Latin');
    expect(body.language.spokenFluency).toBe('accented');
    // Not supplied -> column default.
    expect(body.language.writtenFluency).toBe('none');
    expect(body.language.points).toBe(2);
    expect(body.character.languages).toHaveLength(1);
    expect(body.character.points.languages).toBe(2);
    // Languages must NOT leak into the advantages bucket.
    expect(body.character.points.advantages).toBe(0);
    expect(body.character.points.total).toBe(2);
  });

  it('PATCH updates fluency and points and returns the refreshed character', async () => {
    const { accessToken } = await registerUser('lang-patch');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Aramaic', spokenFluency: 'broken', points: 1 }),
    });
    const { language } = (await createRes.json()) as { language: { id: string } };
    const patchRes = await app.request(
      `/api/v1/characters/${character.id}/languages/${language.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ spokenFluency: 'native', writtenFluency: 'accented', points: 2 }),
      },
    );
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as {
      language: Record<string, unknown>;
      character: { points: Record<string, number> };
    };
    expect(body.language.spokenFluency).toBe('native');
    expect(body.language.writtenFluency).toBe('accented');
    expect(body.character.points.languages).toBe(2);
  });

  it('DELETE removes the language and drops it out of the point ledger', async () => {
    const { accessToken } = await registerUser('lang-delete');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Greek', points: 3 }),
    });
    const { language } = (await createRes.json()) as { language: { id: string } };
    const delRes = await app.request(
      `/api/v1/characters/${character.id}/languages/${language.id}`,
      { method: 'DELETE', headers: bearer(accessToken) },
    );
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as {
      languages: unknown[];
      points: Record<string, number>;
    };
    expect(body.languages).toEqual([]);
    expect(body.points.languages).toBe(0);
  });

  it('PATCH on another character’s language id 404s (scoped by characterId)', async () => {
    const { accessToken } = await registerUser('lang-scope');
    const a = await createCharacter(accessToken);
    const b = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${a.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Latin' }),
    });
    const { language } = (await createRes.json()) as { language: { id: string } };
    const res = await app.request(`/api/v1/characters/${b.id}/languages/${language.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 5 }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown fluency level (422)', async () => {
    const { accessToken } = await registerUser('lang-bad-fluency');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Latin', spokenFluency: 'fluent' }),
    });
    expect(res.status).toBe(422);
  });

  it('non-owner campaign member cannot create a language (403)', async () => {
    const gm = await registerUser('lang-gm');
    const owner = await registerUser('lang-owner');
    const viewer = await registerUser('lang-viewer');
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
    const res = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ name: 'Latin' }),
    });
    expect(res.status).toBe(403);
  });

  it('bulk import: ten languages land and the ledger sums all of them', async () => {
    const { accessToken } = await registerUser('lang-bulk');
    const character = await createCharacter(accessToken);
    const names = Array.from({ length: 10 }, (_, i) => `Tongue ${i}`);
    for (const name of names) {
      const res = await app.request(`/api/v1/characters/${character.id}/languages`, {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ name, spokenFluency: 'broken', points: 1 }),
      });
      expect(res.status).toBe(201);
    }
    const detailRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const detail = (await detailRes.json()) as {
      languages: { name: string }[];
      points: Record<string, number>;
    };
    expect(detail.languages).toHaveLength(10);
    expect(detail.languages.map((l) => l.name).sort()).toEqual([...names].sort());
    expect(detail.points.languages).toBe(10);
    expect(detail.points.total).toBe(10);
  });

  it('every language write lands in the character history feed', async () => {
    const { accessToken } = await registerUser('lang-history');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/languages`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Latin', points: 1 }),
    });
    const { language } = (await createRes.json()) as { language: { id: string } };
    await app.request(`/api/v1/characters/${character.id}/languages/${language.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 3 }),
    });
    const historyRes = await app.request(`/api/v1/characters/${character.id}/history`, {
      headers: bearer(accessToken),
    });
    expect(historyRes.status).toBe(200);
    const events = (await historyRes.json()) as {
      entityClass: string;
      op: string;
      summary: string;
      actorUserId: string | null;
    }[];
    const langEvents = events.filter((e) => e.entityClass === 'character_language');
    expect(langEvents.map((e) => e.op).sort()).toEqual(['insert', 'update']);
    // H4: the trigger picked up the actor from withAudit's GUC.
    expect(langEvents.every((e) => e.actorUserId !== null)).toBe(true);
    expect(langEvents.some((e) => e.summary === 'Added language Latin')).toBe(true);
    expect(langEvents.some((e) => e.summary === 'Latin 1 → 3 pts')).toBe(true);
  });
});

// ===================== TECHNIQUES =====================

async function addSkill(
  accessToken: string,
  characterId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await app.request(`/api/v1/characters/${characterId}/skills`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
}

describe('technique sub-resource CRUD', () => {
  it('POST resolves the level from the default skill and bills its own point bucket', async () => {
    const { accessToken } = await registerUser('tech-create');
    // DX 14 + Average skill at 2 points => level 14.
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', points: 3 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      technique: Record<string, unknown>;
      character: { techniques: unknown[]; points: Record<string, number> };
    };
    expect(body.technique.name).toBe('Feint');
    // Not supplied -> Average default.
    expect(body.technique.difficulty).toBe('A');
    expect(body.technique.defaultSkillLevel).toBe(14);
    expect(body.technique.level).toBe(17);
    expect(body.character.techniques).toHaveLength(1);
    expect(body.character.points.techniques).toBe(3);
    expect(body.character.points.skills).toBe(2);
  });

  it('a Hard technique burns its first point on the default', async () => {
    const { accessToken } = await registerUser('tech-hard');
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        name: 'Disarming',
        defaultSkillName: 'Broadsword',
        difficulty: 'H',
        points: 3,
      }),
    });
    const body = (await res.json()) as { technique: Record<string, unknown> };
    expect(body.technique.level).toBe(16);
  });

  it('applies the default-line penalty to the level and PATCHes it through', async () => {
    const { accessToken } = await registerUser('tech-default');
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Riding',
      attribute: 'DX',
      difficulty: 'A',
      points: 8,
    });
    // DX 14, Average, 8 pts -> 16. A default line of -7 puts the
    // 0-point technique at 9, matching how the veteran sheet records
    // "Combat Riding" (Riding 23 shown as such, technique at 16 = 23-7).
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        name: 'Combat Riding',
        defaultSkillName: 'Riding',
        difficulty: 'H',
        points: 0,
        defaultModifier: -7,
      }),
    });
    const body = (await res.json()) as { technique: Record<string, unknown> };
    expect(body.technique.defaultSkillLevel).toBe(16);
    expect(body.technique.defaultModifier).toBe(-7);
    // 0 points on a Hard technique sits at the default line (skill -7).
    expect(body.technique.level).toBe(9);

    // Buying up from the default line: Hard burns the first point.
    const { technique } = body as unknown as { technique: { id: string } };
    const patchRes = await app.request(
      `/api/v1/characters/${character.id}/techniques/${technique.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ points: 1 }),
      },
    );
    const patched = (await patchRes.json()) as { technique: Record<string, unknown> };
    expect(patched.technique.level).toBe(9);
  });

  it('caps the level at maxLevel', async () => {
    const { accessToken } = await registerUser('tech-cap');
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        name: 'Feint',
        defaultSkillName: 'Broadsword',
        points: 9,
        maxLevel: 2,
      }),
    });
    const body = (await res.json()) as { technique: Record<string, unknown> };
    expect(body.technique.level).toBe(16);
  });

  it('level is null while the default skill is missing, and resolves once it is added', async () => {
    const { accessToken } = await registerUser('tech-missing-skill');
    const character = await createCharacter(accessToken, { dx: 14 });
    const createRes = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', points: 2 }),
    });
    const created = (await createRes.json()) as { technique: Record<string, unknown> };
    expect(created.technique.level).toBeNull();
    expect(created.technique.defaultSkillLevel).toBeNull();

    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });
    const detailRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const detail = (await detailRes.json()) as { techniques: { level: number | null }[] };
    expect(detail.techniques[0]?.level).toBe(16);
  });

  it('a specialized skill resolves through its "Name (Spec)" display form', async () => {
    const { accessToken } = await registerUser('tech-spec');
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Savoir-Faire',
      specialization: 'Dojo',
      attribute: 'IQ',
      difficulty: 'E',
      points: 1,
    });
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        name: 'Style Familiarity',
        defaultSkillName: 'Savoir-Faire (Dojo)',
        points: 1,
      }),
    });
    const body = (await res.json()) as { technique: Record<string, unknown> };
    expect(body.technique.defaultSkillLevel).toBe(10); // IQ 10, Easy, 1 pt
    expect(body.technique.level).toBe(11);
  });

  it('PATCH updates points and re-resolves the level', async () => {
    const { accessToken } = await registerUser('tech-patch');
    const character = await createCharacter(accessToken, { dx: 14 });
    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 2,
    });
    const createRes = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', points: 1 }),
    });
    const { technique } = (await createRes.json()) as { technique: { id: string } };
    const patchRes = await app.request(
      `/api/v1/characters/${character.id}/techniques/${technique.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ points: 4 }),
      },
    );
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as {
      technique: Record<string, unknown>;
      character: { points: Record<string, number> };
    };
    expect(body.technique.points).toBe(4);
    expect(body.technique.level).toBe(18);
    expect(body.character.points.techniques).toBe(4);
  });

  it('DELETE removes the technique and drops it from the ledger', async () => {
    const { accessToken } = await registerUser('tech-delete');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', points: 3 }),
    });
    const { technique } = (await createRes.json()) as { technique: { id: string } };
    const delRes = await app.request(
      `/api/v1/characters/${character.id}/techniques/${technique.id}`,
      { method: 'DELETE', headers: bearer(accessToken) },
    );
    expect(delRes.status).toBe(200);
    const body = (await delRes.json()) as {
      techniques: unknown[];
      points: Record<string, number>;
    };
    expect(body.techniques).toEqual([]);
    expect(body.points.techniques).toBe(0);
  });

  it('rejects a difficulty outside A/H (422) and a missing default skill (422)', async () => {
    const { accessToken } = await registerUser('tech-invalid');
    const character = await createCharacter(accessToken);
    const badDifficulty = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', difficulty: 'VH' }),
    });
    expect(badDifficulty.status).toBe(422);
    const missingSkill = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint' }),
    });
    expect(missingSkill.status).toBe(422);
  });

  it('PATCH on another character’s technique id 404s (scoped by characterId)', async () => {
    const { accessToken } = await registerUser('tech-scope');
    const a = await createCharacter(accessToken);
    const b = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${a.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword' }),
    });
    const { technique } = (await createRes.json()) as { technique: { id: string } };
    const res = await app.request(`/api/v1/characters/${b.id}/techniques/${technique.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 5 }),
    });
    expect(res.status).toBe(404);
  });

  it('non-owner campaign member cannot create a technique (403)', async () => {
    const gm = await registerUser('tech-gm');
    const owner = await registerUser('tech-owner');
    const viewer = await registerUser('tech-viewer');
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
    const res = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(viewer.accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword' }),
    });
    expect(res.status).toBe(403);
  });

  it('technique writes land in the character history feed', async () => {
    const { accessToken } = await registerUser('tech-history');
    const character = await createCharacter(accessToken);
    const createRes = await app.request(`/api/v1/characters/${character.id}/techniques`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Feint', defaultSkillName: 'Broadsword', points: 1 }),
    });
    const { technique } = (await createRes.json()) as { technique: { id: string } };
    await app.request(`/api/v1/characters/${character.id}/techniques/${technique.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ points: 3 }),
    });
    const historyRes = await app.request(`/api/v1/characters/${character.id}/history`, {
      headers: bearer(accessToken),
    });
    const events = (await historyRes.json()) as {
      entityClass: string;
      op: string;
      summary: string;
      actorUserId: string | null;
    }[];
    const techEvents = events.filter((e) => e.entityClass === 'character_technique');
    expect(techEvents.map((e) => e.op).sort()).toEqual(['insert', 'update']);
    expect(techEvents.every((e) => e.actorUserId !== null)).toBe(true);
    expect(techEvents.some((e) => e.summary === 'Added technique Feint (Broadsword)')).toBe(true);
    expect(techEvents.some((e) => e.summary === 'Feint 1 → 3 pts')).toBe(true);
  });
});

// ===================== POINT LEDGER =====================

describe('point ledger completeness', () => {
  it('spells get their own bucket instead of inflating skills', async () => {
    const { accessToken } = await registerUser('ledger-spells');
    const character = await createCharacter(accessToken);
    await addSkill(accessToken, character.id as string, {
      name: 'Broadsword',
      attribute: 'DX',
      difficulty: 'A',
      points: 4,
    });
    const spellRes = await app.request(`/api/v1/characters/${character.id}/spells`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: 'Ignite Fire', points: 6 }),
    });
    expect(spellRes.status).toBe(201);
    const body = (await spellRes.json()) as { character: { points: Record<string, number> } };
    expect(body.character.points.skills).toBe(4);
    expect(body.character.points.spells).toBe(6);
    expect(body.character.points.total).toBe(10);
  });

  it('a legacy kind="language" trait bills to the languages bucket, not advantages', async () => {
    const { accessToken } = await registerUser('ledger-lang-trait');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ kind: 'language', name: 'Latin', points: 3 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { character: { points: Record<string, number> } };
    expect(body.character.points.languages).toBe(3);
    expect(body.character.points.advantages).toBe(0);
    expect(body.character.points.total).toBe(3);
  });

  it('cultural_familiarity stays an advantage (no first-class entity yet)', async () => {
    const { accessToken } = await registerUser('ledger-cultfam');
    const character = await createCharacter(accessToken);
    const res = await app.request(`/api/v1/characters/${character.id}/traits`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ kind: 'cultural_familiarity', name: 'Roman', points: 1 }),
    });
    const body = (await res.json()) as { character: { points: Record<string, number> } };
    expect(body.character.points.advantages).toBe(1);
    expect(body.character.points.languages).toBe(0);
    expect(body.character.points.total).toBe(1);
  });

  it('unspent is the campaign point target minus every bucket', async () => {
    const owner = await registerUser('ledger-unspent');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}-${Math.random()}`, pointTarget: 200 }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    // ST 12 = 20 pts of attributes.
    const character = await createCharacter(owner.accessToken, {
      campaignId: campaign.id,
      st: 12,
    });
    const post = (path: string, body: Record<string, unknown>) =>
      app.request(`/api/v1/characters/${character.id}/${path}`, {
        method: 'POST',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify(body),
      });
    await post('traits', { kind: 'advantage', name: 'Combat Reflexes', points: 15 });
    await post('traits', { kind: 'disadvantage', name: 'Bad Temper', points: -10 });
    await post('skills', { name: 'Broadsword', attribute: 'DX', difficulty: 'A', points: 8 });
    await post('spells', { name: 'Ignite Fire', points: 4 });
    await post('languages', { name: 'Latin', spokenFluency: 'accented', points: 2 });
    await post('techniques', { name: 'Feint', defaultSkillName: 'Broadsword', points: 3 });

    const detailRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(owner.accessToken),
    });
    const detail = (await detailRes.json()) as { points: Record<string, number> };
    expect(detail.points).toMatchObject({
      attributes: 20,
      secondary: 0,
      advantages: 15,
      disadvantages: -10,
      quirks: 0,
      languages: 2,
      skills: 8,
      spells: 4,
      techniques: 3,
    });
    expect(detail.points.total).toBe(42);
    expect(detail.points.unspent).toBe(158);
  });

  it('unspent goes negative when the character is over the campaign target', async () => {
    const owner = await registerUser('ledger-over');
    const campaignRes = await app.request('/api/v1/campaigns', {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: `Camp ${Date.now()}-${Math.random()}`, pointTarget: 10 }),
    });
    const campaign = (await campaignRes.json()) as { id: string };
    const character = await createCharacter(owner.accessToken, {
      campaignId: campaign.id,
      st: 12,
    });
    const detailRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(owner.accessToken),
    });
    const detail = (await detailRes.json()) as { points: Record<string, number> };
    expect(detail.points.total).toBe(20);
    expect(detail.points.unspent).toBe(-10);
  });

  it('unspent is 0 for a campaignless character (nothing to be unspent against)', async () => {
    const { accessToken } = await registerUser('ledger-nocampaign');
    const character = await createCharacter(accessToken, { st: 12 });
    const detailRes = await app.request(`/api/v1/characters/${character.id}`, {
      headers: bearer(accessToken),
    });
    const detail = (await detailRes.json()) as { points: Record<string, number> };
    expect(detail.points.total).toBe(20);
    expect(detail.points.unspent).toBe(0);
  });
});
