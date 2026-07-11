/**
 * Characterization tests for src/server/routes/campaignLibrary.ts
 * (per-campaign trait/skill/spell/item library CRUD + YAML import/export).
 *
 * These pin CURRENT behavior ahead of a refactor — not a spec for what the
 * routes "should" do.
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

async function registerUser(suffix: string) {
  const email = `library-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
}

async function createCampaign(
  accessToken: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Camp ${Date.now()}-${Math.random()}`, ...overrides }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function addMember(ownerToken: string, campaignId: string, email: string, role?: 'manager') {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { members: { userId: string; email: string }[] };
  if (role) {
    const member = body.members.find((m) => m.email === email);
    if (!member) throw new Error('member not found after add');
    const promoteRes = await app.request(
      `/api/v1/campaigns/${campaignId}/members/${member.userId}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(ownerToken),
        body: JSON.stringify({ role }),
      },
    );
    expect(promoteRes.status).toBe(200);
  }
}

async function createTrait(
  accessToken: string,
  campaignId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/library/traits`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      kind: 'advantage',
      name: `Trait ${Date.now()}-${Math.random()}`,
      ...overrides,
    }),
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// ===================== CRUD =====================

describe('library trait CRUD', () => {
  it('POST creates with basePoints defaulting to 0; PATCH updates; DELETE removes', async () => {
    const owner = await registerUser('trait-crud');
    const campaign = await createCampaign(owner.accessToken);
    const { res: createRes, body: created } = await createTrait(
      owner.accessToken,
      campaign.id as string,
      { name: 'Toughness' },
    );
    expect(createRes.status).toBe(201);
    expect(created.basePoints).toBe(0);

    const patchRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/traits/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ basePoints: 10 }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.basePoints).toBe(10);

    const delRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/traits/${created.id}`,
      { method: 'DELETE', headers: bearer(owner.accessToken) },
    );
    expect(delRes.status).toBe(204);
  });
});

describe('library skill CRUD', () => {
  it('POST creates, PATCH updates, DELETE removes', async () => {
    const owner = await registerUser('skill-crud');
    const campaign = await createCampaign(owner.accessToken);
    const createRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/skills`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Fencing', attribute: 'DX', difficulty: 'A' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.attribute).toBe('DX');

    const patchRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ difficulty: 'H' }),
      },
    );
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.difficulty).toBe('H');

    const delRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${created.id}`,
      { method: 'DELETE', headers: bearer(owner.accessToken) },
    );
    expect(delRes.status).toBe(204);
  });
});

describe('library spell CRUD', () => {
  it('POST creates with difficulty defaulting to H, baseEnergyCost defaulting to 1; PATCH; DELETE', async () => {
    const owner = await registerUser('spell-crud');
    const campaign = await createCampaign(owner.accessToken);
    const createRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/spells`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Fireball' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.difficulty).toBe('H');
    expect(created.baseEnergyCost).toBe(1);

    const patchRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/spells/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ baseEnergyCost: 3 }),
      },
    );
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.baseEnergyCost).toBe(3);

    const delRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/spells/${created.id}`,
      { method: 'DELETE', headers: bearer(owner.accessToken) },
    );
    expect(delRes.status).toBe(204);
  });
});

describe('library item CRUD', () => {
  it('POST creates with category="general", defaultQuantity=1, weightLbs/cost=0; numbers coerced from decimal columns; PATCH; DELETE', async () => {
    const owner = await registerUser('item-crud');
    const campaign = await createCampaign(owner.accessToken);
    const createRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/items`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ name: 'Rope (50ft)' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.category).toBe('general');
    expect(created.defaultQuantity).toBe(1);
    expect(created.weightLbs).toBe(0);
    expect(created.cost).toBe(0);

    const patchRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/items/${created.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ weightLbs: 8.5, cost: 2.5 }),
      },
    );
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.weightLbs).toBe(8.5);
    expect(typeof patched.weightLbs).toBe('number');
    expect(patched.cost).toBe(2.5);

    const delRes = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/items/${created.id}`,
      { method: 'DELETE', headers: bearer(owner.accessToken) },
    );
    expect(delRes.status).toBe(204);
  });
});

// ===================== READ / PERMISSION GATES =====================

describe('GET /campaigns/{id}/library', () => {
  it('owner and plain member can read; non-member cannot (403)', async () => {
    const owner = await registerUser('read-owner');
    const member = await registerUser('read-member');
    const outsider = await registerUser('read-outsider');
    const campaign = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaign.id as string, member.email);
    await createTrait(owner.accessToken, campaign.id as string, { name: 'Readable Trait' });

    const ownerRes = await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
      headers: bearer(owner.accessToken),
    });
    expect(ownerRes.status).toBe(200);
    const ownerBody = (await ownerRes.json()) as { traits: unknown[] };
    expect(ownerBody.traits.length).toBe(1);

    const memberRes = await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
      headers: bearer(member.accessToken),
    });
    expect(memberRes.status).toBe(200);

    const outsiderRes = await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
      headers: bearer(outsider.accessToken),
    });
    expect(outsiderRes.status).toBe(403);
  });
});

describe('write permission gates', () => {
  it('a plain member cannot create a library trait (403)', async () => {
    const owner = await registerUser('gate-owner');
    const member = await registerUser('gate-member');
    const campaign = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaign.id as string, member.email);
    const { res } = await createTrait(member.accessToken, campaign.id as string);
    expect(res.status).toBe(403);
  });

  it('a manager ALSO cannot write to the library — only the campaign owner can (pinning current behavior)', async () => {
    const owner = await registerUser('gate-manager-owner');
    const manager = await registerUser('gate-manager');
    const campaign = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaign.id as string, manager.email, 'manager');
    const { res } = await createTrait(manager.accessToken, campaign.id as string);
    expect(res.status).toBe(403);
  });

  it('a non-member cannot write (403)', async () => {
    const owner = await registerUser('gate-outsider-owner');
    const outsider = await registerUser('gate-outsider');
    const campaign = await createCampaign(owner.accessToken);
    const { res } = await createTrait(outsider.accessToken, campaign.id as string);
    expect(res.status).toBe(403);
  });
});

// ===================== YAML EXPORT / IMPORT =====================

describe('YAML export/import round trip', () => {
  async function seedLibrary(ownerToken: string, campaignId: string) {
    await createTrait(ownerToken, campaignId, { name: 'Toughness', basePoints: 1 });
    await app.request(`/api/v1/campaigns/${campaignId}/library/skills`, {
      method: 'POST',
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ name: 'Fencing', attribute: 'DX', difficulty: 'A' }),
    });
    await app.request(`/api/v1/campaigns/${campaignId}/library/spells`, {
      method: 'POST',
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ name: 'Fireball' }),
    });
    await app.request(`/api/v1/campaigns/${campaignId}/library/items`, {
      method: 'POST',
      headers: jsonHeaders(ownerToken),
      body: JSON.stringify({ name: 'Rope (50ft)', weightLbs: 8 }),
    });
  }

  async function exportYaml(ownerToken: string, campaignId: string): Promise<string> {
    const res = await app.request(`/api/v1/campaigns/${campaignId}/library/export`, {
      headers: bearer(ownerToken),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/yaml');
    return res.text();
  }

  it('exports a YAML doc containing the seeded entities', async () => {
    const owner = await registerUser('export-basic');
    const campaign = await createCampaign(owner.accessToken);
    await seedLibrary(owner.accessToken, campaign.id as string);
    const yaml = await exportYaml(owner.accessToken, campaign.id as string);
    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('Toughness');
    expect(yaml).toContain('Fencing');
    expect(yaml).toContain('Fireball');
    expect(yaml).toContain('Rope');
  });

  it('re-importing the same export into the same campaign (mode=merge, the default) updates existing rows in place and does not duplicate them', async () => {
    const owner = await registerUser('import-merge-same');
    const campaign = await createCampaign(owner.accessToken);
    await seedLibrary(owner.accessToken, campaign.id as string);
    const yaml = await exportYaml(owner.accessToken, campaign.id as string);

    const importRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml }),
    });
    expect(importRes.status).toBe(200);
    const result = (await importRes.json()) as {
      mode: string;
      traits: { created: number; updated: number; deleted: number };
      skills: { created: number; updated: number; deleted: number };
      spells: { created: number; updated: number; deleted: number };
      items: { created: number; updated: number; deleted: number };
    };
    expect(result.mode).toBe('merge');
    expect(result.traits).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(result.skills).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(result.spells).toEqual({ created: 0, updated: 1, deleted: 0 });
    expect(result.items).toEqual({ created: 0, updated: 1, deleted: 0 });

    const listRes = await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
      headers: bearer(owner.accessToken),
    });
    const list = (await listRes.json()) as { traits: unknown[]; skills: unknown[] };
    expect(list.traits.length).toBe(1);
    expect(list.skills.length).toBe(1);
  });

  it('key semantics: same name (same kind for traits) updates in place; a new name inserts', async () => {
    const owner = await registerUser('import-key-semantics');
    const campaign = await createCampaign(owner.accessToken);
    await createTrait(owner.accessToken, campaign.id as string, {
      name: 'Toughness',
      basePoints: 1,
    });
    const yamlWithOriginal = await exportYaml(owner.accessToken, campaign.id as string);

    // Mutate the trait directly, then re-import the ORIGINAL exported yaml:
    // the import should overwrite basePoints back to the original value
    // because the key (kind, lowercased name) matches an existing row.
    const listBefore = (await (
      await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: { id: string }[] };
    const traitId = listBefore.traits[0]?.id;
    if (!traitId) throw new Error('expected seeded trait');
    await app.request(`/api/v1/campaigns/${campaign.id}/library/traits/${traitId}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ basePoints: 99 }),
    });

    const importRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml: yamlWithOriginal }),
    });
    const result = (await importRes.json()) as {
      traits: { created: number; updated: number; deleted: number };
    };
    expect(result.traits).toEqual({ created: 0, updated: 1, deleted: 0 });

    const listAfter = (await (
      await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: { id: string; basePoints: number }[] };
    expect(listAfter.traits.length).toBe(1);
    expect(listAfter.traits[0]?.basePoints).toBe(1); // reverted by the import

    // A yaml with a brand-new trait name inserts a second row (not a rename).
    const yamlPlusNew = yamlWithOriginal.replace(
      'library:\n  traits:\n',
      'library:\n  traits:\n    - name: Wealth\n      kind: advantage\n',
    );
    const secondImportRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml: yamlPlusNew }),
    });
    expect(secondImportRes.status).toBe(200);
    const secondResult = (await secondImportRes.json()) as {
      traits: { created: number; updated: number; deleted: number };
    };
    expect(secondResult.traits).toEqual({ created: 1, updated: 1, deleted: 0 });
  });

  it('mode=replace prunes rows not present in the imported document', async () => {
    const owner = await registerUser('import-replace');
    const campaign = await createCampaign(owner.accessToken);
    await seedLibrary(owner.accessToken, campaign.id as string);
    const originalYaml = await exportYaml(owner.accessToken, campaign.id as string);

    // Add an extra trait that is NOT in originalYaml.
    await createTrait(owner.accessToken, campaign.id as string, { name: 'Extra Trait' });
    const beforeList = (await (
      await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: unknown[] };
    expect(beforeList.traits.length).toBe(2);

    // merge mode leaves the extra trait alone.
    const mergeRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml: originalYaml, mode: 'merge' }),
    });
    expect(mergeRes.status).toBe(200);
    const afterMergeList = (await (
      await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: unknown[] };
    expect(afterMergeList.traits.length).toBe(2);

    // replace mode prunes it.
    const replaceRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml: originalYaml, mode: 'replace' }),
    });
    expect(replaceRes.status).toBe(200);
    const replaceResult = (await replaceRes.json()) as {
      mode: string;
      traits: { created: number; updated: number; deleted: number };
    };
    expect(replaceResult.mode).toBe('replace');
    expect(replaceResult.traits.deleted).toBe(1);
    const afterReplaceList = (await (
      await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: { name: string }[] };
    expect(afterReplaceList.traits.length).toBe(1);
    expect(afterReplaceList.traits.some((t) => t.name === 'Extra Trait')).toBe(false);
  });

  it('importing into a second campaign creates fresh rows there and does not touch the first campaign', async () => {
    const owner = await registerUser('import-cross-campaign');
    const campaign1 = await createCampaign(owner.accessToken);
    const campaign2 = await createCampaign(owner.accessToken);
    await seedLibrary(owner.accessToken, campaign1.id as string);
    const yaml = await exportYaml(owner.accessToken, campaign1.id as string);

    const importRes = await app.request(`/api/v1/campaigns/${campaign2.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml }),
    });
    expect(importRes.status).toBe(200);
    const result = (await importRes.json()) as {
      traits: { created: number; updated: number; deleted: number };
      skills: { created: number; updated: number; deleted: number };
      spells: { created: number; updated: number; deleted: number };
      items: { created: number; updated: number; deleted: number };
    };
    expect(result.traits).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(result.skills).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(result.spells).toEqual({ created: 1, updated: 0, deleted: 0 });
    expect(result.items).toEqual({ created: 1, updated: 0, deleted: 0 });

    const campaign1List = (await (
      await app.request(`/api/v1/campaigns/${campaign1.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: unknown[] };
    const campaign2List = (await (
      await app.request(`/api/v1/campaigns/${campaign2.id}/library`, {
        headers: bearer(owner.accessToken),
      })
    ).json()) as { traits: unknown[] };
    expect(campaign1List.traits.length).toBe(1);
    expect(campaign2List.traits.length).toBe(1);
  });

  it('a plain member cannot import (403); a non-member cannot import (403)', async () => {
    const owner = await registerUser('import-gate-owner');
    const member = await registerUser('import-gate-member');
    const outsider = await registerUser('import-gate-outsider');
    const campaign = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaign.id as string, member.email);
    await seedLibrary(owner.accessToken, campaign.id as string);
    const yaml = await exportYaml(owner.accessToken, campaign.id as string);

    const memberRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(member.accessToken),
      body: JSON.stringify({ yaml }),
    });
    expect(memberRes.status).toBe(403);

    const outsiderRes = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(outsider.accessToken),
      body: JSON.stringify({ yaml }),
    });
    expect(outsiderRes.status).toBe(403);
  });

  it('invalid YAML is rejected with 400', async () => {
    const owner = await registerUser('import-invalid');
    const campaign = await createCampaign(owner.accessToken);
    const res = await app.request(`/api/v1/campaigns/${campaign.id}/library/import`, {
      method: 'POST',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ yaml: 'not: [valid, library, yaml' }),
    });
    expect(res.status).toBe(400);
  });
});
