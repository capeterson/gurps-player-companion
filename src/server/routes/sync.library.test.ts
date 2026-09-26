/**
 * Campaign-library sync (AGENTS.md S0/S6/S12/S13): library entries travel
 * through `/sync/operations` and `/sync/cursor` with the same owner-only
 * guards, validation and fan-out as the REST library routes.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import type { SyncCursorResponse } from '../../shared/schemas/sync.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `library-sync-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
}

async function createCampaign(accessToken: string): Promise<string> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Library sync ${Date.now()}-${Math.random()}` }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function addMember(ownerToken: string, campaignId: string, email: string) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
    method: 'POST',
    headers: jsonHeaders(ownerToken),
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
}

type Outcome = {
  clientOpId: string;
  status: string;
  newRevision?: number;
  reason?: string;
  latestEntity?: Record<string, unknown>;
};

async function send(token: string, operation: Record<string, unknown>): Promise<Outcome> {
  const res = await app.request('/api/v1/sync/operations', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({
      operations: [
        {
          clientOpId: crypto.randomUUID(),
          validationVersion: 1,
          createdAt: new Date().toISOString(),
          ...operation,
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { outcomes: Outcome[] };
  return body.outcomes[0] as Outcome;
}

async function pull(token: string, entityClass: string, sinceRevision = 0) {
  const res = await app.request('/api/v1/sync/cursor', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ cursors: [{ entityClass, sinceRevision }] }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SyncCursorResponse;
}

async function library(token: string, campaignId: string) {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/library`, {
    headers: jsonHeaders(token),
  });
  return (await res.json()) as { skills: Array<Record<string, unknown>> };
}

const skillBody = (name: string) => ({ name, attribute: 'DX', difficulty: 'A' });

describe('library classes through /sync/operations', () => {
  it('lets the owner create with the client id, whole-entry patch and delete', async () => {
    const owner = await registerUser('owner');
    const campaignId = await createCampaign(owner.accessToken);
    const id = crypto.randomUUID();

    const created = await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'create',
      parentId: campaignId,
      attemptedValue: skillBody('Stealth'),
    });
    expect(created).toMatchObject({ status: 'applied' });
    expect((await library(owner.accessToken, campaignId)).skills).toEqual([
      expect.objectContaining({ id, name: 'Stealth' }),
    ]);

    const patched = await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'patch',
      parentId: campaignId,
      baseRevision: created.newRevision,
      attemptedValue: {
        ...skillBody('Stealth'),
        description: 'Move quietly',
        techLevelPolicy: { kind: 'fixed', techLevel: 3 },
      },
    });
    expect(patched.status).toBe('applied');
    expect(patched.newRevision).toBeGreaterThan(created.newRevision ?? 0);
    // The shared service normalized the TL policy exactly as REST PATCH does.
    expect((await library(owner.accessToken, campaignId)).skills[0]).toMatchObject({
      description: 'Move quietly',
      techLevel: 3,
    });

    // Replaying the create (response lost) resolves to the saved row.
    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'create',
        parentId: campaignId,
        attemptedValue: skillBody('Stealth'),
      }),
    ).toMatchObject({ status: 'applied' });

    const deleted = await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'delete',
      parentId: campaignId,
    });
    expect(deleted.status).toBe('applied');
    expect((await library(owner.accessToken, campaignId)).skills).toEqual([]);
    // Replayed deletes are idempotent.
    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'delete',
        parentId: campaignId,
      }),
    ).toMatchObject({ status: 'applied' });
  });

  it('refuses members, foreign campaigns, field patches, invalid bodies and duplicates', async () => {
    const owner = await registerUser('guard-owner');
    const member = await registerUser('guard-member');
    const campaignId = await createCampaign(owner.accessToken);
    const otherCampaignId = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaignId, member.email);
    const id = crypto.randomUUID();
    await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'create',
      parentId: campaignId,
      attemptedValue: skillBody('Climbing'),
    });

    for (const operation of [
      { command: 'create', entityId: crypto.randomUUID(), attemptedValue: skillBody('Sneaky') },
      { command: 'patch', entityId: id, attemptedValue: { description: 'member edit' } },
      { command: 'delete', entityId: id },
    ]) {
      expect(
        await send(member.accessToken, {
          entityClass: 'campaign_library_skill',
          parentId: campaignId,
          ...operation,
        }),
      ).toMatchObject({ status: 'unauthorized' });
    }

    // The row must belong to the campaign the envelope names.
    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'patch',
        parentId: otherCampaignId,
        attemptedValue: { description: 'wrong campaign' },
      }),
    ).toMatchObject({ status: 'unauthorized' });

    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'patch',
        parentId: campaignId,
        fieldPath: 'description',
        attemptedValue: 'field patch',
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'library entries accept whole-entry patches only',
    });

    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: crypto.randomUUID(),
        command: 'create',
        attemptedValue: skillBody('No campaign'),
      }),
    ).toMatchObject({ status: 'rejected' });

    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'patch',
        parentId: campaignId,
        attemptedValue: { difficulty: 'Impossible' },
      }),
    ).toMatchObject({ status: 'rejected' });

    // Cross-field validation (validateRow) matches REST.
    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: id,
        command: 'patch',
        parentId: campaignId,
        attemptedValue: { specializationPolicy: { kind: 'none' }, defaultSpecialization: 'Rock' },
      }),
    ).toMatchObject({ status: 'rejected' });

    expect(
      await send(owner.accessToken, {
        entityClass: 'campaign_library_skill',
        entityId: crypto.randomUUID(),
        command: 'create',
        parentId: campaignId,
        attemptedValue: skillBody('climbing'),
      }),
    ).toMatchObject({ status: 'conflict' });

    expect((await library(owner.accessToken, campaignId)).skills).toEqual([
      expect.objectContaining({ id, name: 'Climbing', description: null }),
    ]);
  });

  it('returns the public row on stale_base', async () => {
    const owner = await registerUser('stale');
    const campaignId = await createCampaign(owner.accessToken);
    const id = crypto.randomUUID();
    const created = await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'create',
      parentId: campaignId,
      attemptedValue: skillBody('Lockpicking'),
    });
    await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'patch',
      parentId: campaignId,
      baseRevision: created.newRevision,
      attemptedValue: { source: 'B206' },
    });

    const stale = await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'patch',
      parentId: campaignId,
      baseRevision: created.newRevision,
      attemptedValue: { description: 'late edit' },
    });

    expect(stale.status).toBe('stale_base');
    expect(stale.latestEntity).toMatchObject({
      id,
      campaignId,
      name: 'Lockpicking',
      source: 'B206',
      revision: expect.any(Number),
    });
    expect(typeof stale.latestEntity?.createdAt).toBe('string');
  });
});

describe('library classes through /sync/cursor', () => {
  it('delivers rows and tombstones to members but never to outsiders', async () => {
    const owner = await registerUser('cursor-owner');
    const member = await registerUser('cursor-member');
    const outsider = await registerUser('cursor-outsider');
    const campaignId = await createCampaign(owner.accessToken);
    await addMember(owner.accessToken, campaignId, member.email);
    const id = crypto.randomUUID();
    await send(owner.accessToken, {
      entityClass: 'campaign_library_skill',
      entityId: id,
      command: 'create',
      parentId: campaignId,
      attemptedValue: skillBody('Tracking'),
    });

    const memberPull = await pull(member.accessToken, 'campaign_library_skill');
    expect(memberPull.changes).toEqual([
      expect.objectContaining({
        entityClass: 'campaign_library_skill',
        entityId: id,
        data: expect.objectContaining({
          id,
          campaignId,
          name: 'Tracking',
          revision: expect.any(Number),
        }),
      }),
    ]);
    expect((await pull(outsider.accessToken, 'campaign_library_skill')).changes).toEqual([]);

    const since = memberPull.nextCursor.campaign_library_skill ?? 0;
    // REST deletes reach devices through the same tombstone path.
    const res = await app.request(`/api/v1/campaigns/${campaignId}/library/skills/${id}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.accessToken),
    });
    expect(res.status).toBe(204);
    expect((await pull(member.accessToken, 'campaign_library_skill', since)).changes).toEqual([
      expect.objectContaining({ entityId: id, command: 'delete' }),
    ]);
    expect((await pull(outsider.accessToken, 'campaign_library_skill', since)).changes).toEqual([]);
  });

  it('emits every library class with its public projection', async () => {
    const owner = await registerUser('cursor-classes');
    const campaignId = await createCampaign(owner.accessToken);
    const creates: Array<[string, string, Record<string, unknown>]> = [
      ['campaign_library_trait', 'traits', { name: 'Luck', kind: 'advantage' }],
      ['campaign_library_spell', 'spells', { name: 'Light' }],
      ['campaign_library_item', 'items', { name: 'Rope', weightLbs: 1.5, cost: 5 }],
      ['campaign_library_enchantment', 'enchantments', { name: 'Accuracy' }],
      [
        'campaign_library_active_effect',
        'active-effects',
        { name: 'Bless', stacking: { kind: 'additive', key: 'blessing' } },
      ],
      ['campaign_library_language', 'languages', { name: 'Elvish' }],
    ];
    for (const [entityClass, , body] of creates) {
      const outcome = await send(owner.accessToken, {
        entityClass,
        entityId: crypto.randomUUID(),
        command: 'create',
        parentId: campaignId,
        attemptedValue: body,
      });
      expect(outcome).toMatchObject({ status: 'applied' });
    }
    for (const [entityClass, , body] of creates) {
      const changes = (await pull(owner.accessToken, entityClass)).changes;
      expect(changes).toEqual([
        expect.objectContaining({ data: expect.objectContaining({ name: body.name, campaignId }) }),
      ]);
    }
    const [item] = (await pull(owner.accessToken, 'campaign_library_item')).changes;
    // Decimal columns arrive as numbers, matching the REST projection.
    expect(item?.data).toMatchObject({ weightLbs: 1.5, cost: 5 });
  });
});
