import { expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { CharacterDetail } from '../../shared/schemas/character.ts';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import { createApp } from '../app.ts';
import { withAudit } from '../db/auditContext.ts';
import { getDb } from '../db/client.ts';
import { campaigns, characterTraits } from '../db/schema.ts';
import { prepareLibraryReference } from '../services/libraryReferences.ts';
import { detachLibraryReferencesForTransfer } from '../services/ownedLibraryMechanics.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
function request(token: string, path: string, body?: unknown, method = 'POST') {
  return Promise.resolve(
    app.request(`/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function register() {
  const email = `references-${crypto.randomUUID()}@example.com`;
  const response = await request('', '/auth/register', {
    email,
    password: 'TestPassword1!',
    displayName: 'Reference tester',
  });
  expect(response.status).toBe(201);
  const value = (await response.json()) as { accessToken: string };
  const userId = JSON.parse(atob(value.accessToken.split('.')[1] ?? '')).sub as string;
  return { token: value.accessToken, email, userId };
}
async function create(token: string, path: string, body: unknown) {
  const response = await request(token, path, body);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}
const configs = [
  {
    kind: 'traits',
    field: 'libraryTraitId',
    entity: 'character_trait',
    output: 'trait',
    body: { kind: 'advantage' },
  },
  {
    kind: 'skills',
    field: 'librarySkillId',
    entity: 'character_skill',
    output: 'skill',
    body: { attribute: 'DX', difficulty: 'A' },
  },
  { kind: 'spells', field: 'librarySpellId', entity: 'character_spell', output: 'spell', body: {} },
  {
    kind: 'inventory',
    library: 'items',
    field: 'libraryItemId',
    entity: 'character_inventory',
    output: 'item',
    body: {},
  },
  {
    kind: 'languages',
    field: 'libraryLanguageId',
    entity: 'character_language',
    output: 'language',
    body: {},
  },
  {
    kind: 'techniques',
    field: 'libraryTechniqueId',
    entity: 'character_technique',
    output: 'technique',
    body: { defaultSkillName: 'Fencing' },
  },
] as const;
const doors = ['rest-create', 'rest-patch', 'sync-create', 'sync-field', 'sync-body'] as const;

it.each(['source-delete', 'campaign-transfer', 'membership-removal'] as const)(
  'acknowledges lost-response creates after %s without reapplying stale source links',
  async (action) => {
    const gm = await register();
    const player = await register();
    const outsider = await register();
    const campaign = await create(gm.token, '/campaigns', { name: 'Replay source' });
    await request(gm.token, `/campaigns/${campaign.id}/members`, { email: player.email });
    const character = await create(player.token, '/characters', {
      name: 'Owned replay',
      campaignId: campaign.id,
    });
    const operations: Record<string, unknown>[] = [];
    const sources = [];
    for (const cfg of configs) {
      const libraryKind = 'library' in cfg ? cfg.library : cfg.kind;
      const source = await create(gm.token, `/campaigns/${campaign.id}/library/${libraryKind}`, {
        name: 'Replay rules',
        ...cfg.body,
        ...(cfg.kind === 'traits' || cfg.kind === 'skills'
          ? { effects: [{ target: 'dx', value: 2 }] }
          : {}),
      });
      sources.push({ id: source.id, libraryKind });
      operations.push({
        clientOpId: crypto.randomUUID(),
        entityClass: cfg.entity,
        entityId: crypto.randomUUID(),
        parentId: character.id,
        command: 'create',
        attemptedValue: { name: 'Saved copy', ...cfg.body, [cfg.field]: source.id },
        createdAt: new Date().toISOString(),
      });
    }
    const send = async (token = player.token) => {
      const response = await request(token, '/sync/operations', { operations });
      expect(response.status).toBe(200);
      return (await response.json()) as { outcomes: { status: string; newRevision?: number }[] };
    };
    expect((await send()).outcomes.map((outcome) => outcome.status)).toEqual(
      configs.map(() => 'applied'),
    );
    if (action === 'source-delete') {
      for (const source of sources)
        expect(
          (
            await request(
              gm.token,
              `/campaigns/${campaign.id}/library/${source.libraryKind}/${source.id}`,
              undefined,
              'DELETE',
            )
          ).status,
        ).toBe(204);
    } else if (action === 'campaign-transfer') {
      const destination = await create(player.token, '/campaigns', { name: 'Replay destination' });
      expect(
        (
          await request(
            player.token,
            `/characters/${character.id}`,
            { campaignId: destination.id },
            'PATCH',
          )
        ).status,
      ).toBe(200);
    } else
      expect(
        (
          await request(
            gm.token,
            `/campaigns/${campaign.id}/members/${player.userId}`,
            undefined,
            'DELETE',
          )
        ).status,
      ).toBe(204);
    const detail = async () =>
      (await (
        await request(player.token, `/characters/${character.id}`, undefined, 'GET')
      ).json()) as CharacterDetail;
    const before = await detail();
    const replay = await send();
    expect(replay.outcomes.map((outcome) => outcome.status)).toEqual(configs.map(() => 'applied'));
    const after = await detail();
    for (const [index, cfg] of configs.entries()) {
      const rows = after[cfg.kind] as unknown[];
      expect(rows).toHaveLength(1);
      expect(rows).toEqual(before[cfg.kind]);
      expect(replay.outcomes[index]?.newRevision).toBeGreaterThan(0);
    }
    // Knowing the ID does not permit another actor to acknowledge a private row.
    expect(
      (await send(outsider.token)).outcomes.every((outcome) => outcome.status === 'unauthorized'),
    ).toBe(true);
  },
);

it.each(['rest-create', 'sync-create', 'sync-inventory-patch'] as const)(
  'retries a concurrent campaign-scope change for %s',
  async (door) => {
    const owner = await register();
    const campaign = await create(owner.token, '/campaigns', { name: 'Before scope race' });
    const destination = await create(owner.token, '/campaigns', { name: 'After scope race' });
    const character = await create(owner.token, '/characters', {
      name: 'Scope race',
      campaignId: campaign.id,
    });
    const inventory = await create(owner.token, `/characters/${character.id}/inventory`, {
      name: 'Bag',
    });
    const child = (inventory as unknown as { item: { id: string } }).item.id;
    const operation = {
      clientOpId: crypto.randomUUID(),
      entityClass: door === 'sync-inventory-patch' ? 'character_inventory' : 'character_trait',
      entityId: door === 'sync-inventory-patch' ? child : crypto.randomUUID(),
      parentId: character.id,
      command: door === 'sync-inventory-patch' ? 'patch' : 'create',
      ...(door === 'sync-inventory-patch' ? { fieldPath: 'notes' } : {}),
      attemptedValue:
        door === 'sync-inventory-patch'
          ? 'Keep this edit'
          : { name: 'Source-free copy', kind: 'advantage' },
      createdAt: new Date().toISOString(),
    };
    const send = () =>
      door === 'rest-create'
        ? request(owner.token, `/characters/${character.id}/traits`, operation.attemptedValue)
        : request(owner.token, '/sync/operations', { operations: [operation] });
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const holding = withAudit(owner.userId, null, async (tx) => {
      await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for('update');
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      ready.resolve(Number(pid.rows[0]?.pid));
      await release.promise;
    });
    const pid = await ready.promise;
    const racing = send();
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await getDb().execute(sql`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
        ) AS blocked`);
        if (result.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(blocked).toBe(true);
      expect(
        (
          await request(
            owner.token,
            `/characters/${character.id}`,
            { campaignId: destination.id },
            'PATCH',
          )
        ).status,
      ).toBe(200);
    } finally {
      release.resolve();
      await holding;
    }
    const first = await racing;
    if (door === 'rest-create') expect(first.status).toBe(503);
    else
      expect(((await first.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status).toBe(
        'transient',
      );
    const retried = await send();
    if (door === 'rest-create') expect(retried.status).toBe(201);
    else
      expect(
        ((await retried.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
      ).toBe('applied');
    const detail = (await (
      await request(owner.token, `/characters/${character.id}`, undefined, 'GET')
    ).json()) as CharacterDetail;
    if (door === 'sync-inventory-patch') expect(detail.inventory[0]?.notes).toBe('Keep this edit');
    else expect(detail.traits).toHaveLength(1);
  },
  15000,
);

it('member removal waits for an authorized in-flight copy and then detaches it', async () => {
  const gm = await register();
  const player = await register();
  const campaign = await create(gm.token, '/campaigns', { name: 'Concurrent membership' });
  await request(gm.token, `/campaigns/${campaign.id}/members`, { email: player.email });
  const character = await create(player.token, '/characters', {
    name: 'Owned',
    campaignId: campaign.id,
  });
  const source = await create(gm.token, `/campaigns/${campaign.id}/library/traits`, {
    name: 'Rules',
    kind: 'advantage',
    effects: [{ target: 'dx', value: 2 }],
  });
  const captured = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const copying = withAudit(player.userId, null, async (tx) => {
    const values = await prepareLibraryReference(tx, player.userId, character.id, 'traits', {
      characterId: character.id,
      name: 'Copy',
      kind: 'advantage' as const,
      libraryTraitId: source.id,
    });
    captured.resolve();
    await release.promise;
    await tx.insert(characterTraits).values(values);
  });
  await captured.promise;
  let settled = false;
  const removing = request(
    gm.token,
    `/campaigns/${campaign.id.toUpperCase()}/members/${player.userId}`,
    undefined,
    'DELETE',
  ).then((response) => {
    settled = true;
    return response;
  });
  try {
    await Bun.sleep(50);
    expect(settled).toBe(false);
  } finally {
    release.resolve();
    await copying;
  }
  expect((await removing).status).toBe(204);
  const detail = (await (
    await request(player.token, `/characters/${character.id}`, undefined, 'GET')
  ).json()) as CharacterDetail;
  expect(detail.derived.effectiveDx).toBe(12);
  expect(detail.traits[0]?.libraryTraitId).toBeNull();
  expect(detail.traits[0]?.libraryMechanics?.detached).toBe(true);
});

for (const cfg of configs) {
  it(`${cfg.kind}: scopes every REST/sync write and preserves copies when membership ends`, async () => {
    const gm = await register();
    const player = await register();
    const campaign = await create(gm.token, '/campaigns', { name: 'Shared rules' });
    const foreign = await create(gm.token, '/campaigns', { name: 'Private rules' });
    expect(
      (await request(gm.token, `/campaigns/${campaign.id}/members`, { email: player.email }))
        .status,
    ).toBe(200);
    const libraryKind = 'library' in cfg ? cfg.library : cfg.kind;
    const effects =
      cfg.kind === 'traits' || cfg.kind === 'skills'
        ? { effects: [{ target: 'dx', value: 2 }] }
        : {};
    const source = await create(gm.token, `/campaigns/${campaign.id}/library/${libraryKind}`, {
      name: 'Authorized source',
      ...cfg.body,
      ...effects,
    });
    const privateSource = await create(
      gm.token,
      `/campaigns/${foreign.id}/library/${libraryKind}`,
      { name: 'PRIVATE SOURCE SECRET', ...cfg.body, ...effects },
    );
    const wrongKind = await create(gm.token, `/campaigns/${campaign.id}/library/traits`, {
      name: 'Wrong definition kind',
      kind: 'disadvantage',
    });
    const character = await create(player.token, '/characters', {
      name: 'Owned character',
      campaignId: campaign.id,
    });
    const detached = await create(player.token, '/characters', { name: 'Campaignless character' });
    const add = async (characterId: string, sourceId?: string) => {
      const response = await request(player.token, `/characters/${characterId}/${cfg.kind}`, {
        name: 'Owned copy',
        ...cfg.body,
        ...(sourceId ? { [cfg.field]: sourceId } : {}),
      });
      expect(response.status).toBe(201);
      const value = (await response.json()) as Record<string, { id: string }>;
      const row = value[cfg.output];
      if (!row) throw new Error('Missing character entry');
      return row.id;
    };
    const childId = await add(character.id, source.id);
    expect(
      (
        await request(
          player.token,
          `/characters/${character.id}`,
          { campaignId: campaign.id.toUpperCase() },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const unchanged = (await (
      await request(player.token, `/characters/${character.id}`, undefined, 'GET')
    ).json()) as CharacterDetail;
    expect((unchanged[cfg.kind] as unknown as Record<string, unknown>[])[0]?.[cfg.field]).toBe(
      source.id,
    );
    const detachedId = await add(detached.id);
    const write = async (
      door: (typeof doors)[number],
      characterId: string,
      rowId: string,
      sourceId: string,
      allowed: boolean,
      patchOverride?: Record<string, unknown>,
    ) => {
      const patch = patchOverride ?? { [cfg.field]: sourceId, name: 'Attempted edit' };
      let response: Response;
      if (door.startsWith('rest')) {
        response = await request(
          player.token,
          `/characters/${characterId}/${cfg.kind}${door === 'rest-patch' ? `/${rowId}` : ''}`,
          door === 'rest-create' ? { name: 'New copy', ...cfg.body, [cfg.field]: sourceId } : patch,
          door === 'rest-create' ? 'POST' : 'PATCH',
        );
        expect(response.status).toBe(allowed ? (door === 'rest-create' ? 201 : 200) : 403);
      } else {
        const fieldPath = patchOverride ? Object.keys(patchOverride)[0] : cfg.field;
        response = await request(player.token, '/sync/operations', {
          operations: [
            {
              clientOpId: crypto.randomUUID(),
              entityClass: cfg.entity,
              parentId: characterId,
              entityId: door === 'sync-create' ? crypto.randomUUID() : rowId,
              command: door === 'sync-create' ? 'create' : 'patch',
              ...(door === 'sync-field' ? { fieldPath } : {}),
              attemptedValue:
                door === 'sync-create'
                  ? { name: 'New copy', ...cfg.body, [cfg.field]: sourceId }
                  : door === 'sync-field'
                    ? patchOverride
                      ? patchOverride[fieldPath ?? '']
                      : sourceId
                    : patch,
              validationVersion: 1,
              createdAt: new Date().toISOString(),
            },
          ],
        });
        expect(response.status).toBe(200);
        const value = (await response.clone().json()) as { outcomes: { status: string }[] };
        expect(value.outcomes[0]?.status).toBe(allowed ? 'applied' : 'unauthorized');
      }
      expect(await response.text()).not.toContain('PRIVATE SOURCE SECRET');
    };
    for (const door of doors)
      await write(door, character.id, childId, source.id.toUpperCase(), true);
    for (const forbiddenId of [privateSource.id, crypto.randomUUID(), wrongKind.id])
      for (const door of doors) await write(door, character.id, childId, forbiddenId, false);
    for (const door of doors) await write(door, detached.id, detachedId, source.id, false);
    if (cfg.kind === 'traits')
      for (const door of ['rest-patch', 'sync-field', 'sync-body'] as const) {
        await write(door, character.id, childId, source.id, true, { kind: 'disadvantage' });
        const [detached] = await getDb().select().from(characterTraits).where(eq(characterTraits.id, childId));
        expect(detached?.libraryTraitId).toBeNull();
        expect(detached?.libraryMechanics?.detached).toBe(true);
        expect((await request(player.token, `/characters/${character.id}/traits/${childId}`, {
          kind: 'advantage', libraryTraitId: source.id,
        }, 'PATCH')).status).toBe(200);
      }
    const detail = async () =>
      (await (
        await request(player.token, `/characters/${character.id}`, undefined, 'GET')
      ).json()) as CharacterDetail;
    const before = await detail();
    expect(
      (
        await request(
          gm.token,
          `/campaigns/${campaign.id.toUpperCase()}/members/${gm.userId.toUpperCase()}`,
          undefined,
          'DELETE',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          gm.token,
          `/campaigns/${campaign.id.toUpperCase()}/members/${player.userId}`,
          undefined,
          'DELETE',
        )
      ).status,
    ).toBe(204);
    const after = await detail();
    expect(after.derived).toEqual(before.derived);
    const rows = after[cfg.kind] as unknown as Record<string, unknown>[];
    expect(rows.every((row) => row[cfg.field] === null)).toBe(true);
    if (cfg.kind === 'traits' || cfg.kind === 'skills') {
      for (const row of rows)
        expect(ownedLibraryEffects(null, campaign.id, row.libraryMechanics)).toEqual([
          { target: 'dx', value: 2, scaling: 'flat' },
        ]);
      expect(
        (
          await request(
            gm.token,
            `/campaigns/${campaign.id}/library/${libraryKind}/${source.id}`,
            { effects: [{ target: 'dx', value: 9 }] },
            'PATCH',
          )
        ).status,
      ).toBe(200);
      expect((await detail()).derived).toEqual(before.derived);
    }
    for (const door of doors) await write(door, character.id, childId, source.id, false);
    expect((await detail()).derived).toEqual(before.derived);
    // A transfer ends all six live reference kinds, even without effect declarations.
    const transferred = await create(gm.token, '/characters', {
      name: 'Transfer',
      campaignId: campaign.id,
    });
    const transferCopy = await request(gm.token, `/characters/${transferred.id}/${cfg.kind}`, {
      name: 'Transfer copy',
      ...cfg.body,
      [cfg.field]: source.id,
    });
    expect(transferCopy.status).toBe(201);
    expect(
      (
        await request(
          gm.token,
          `/characters/${transferred.id}`,
          { campaignId: foreign.id },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const transferredDetail = (await (
      await request(gm.token, `/characters/${transferred.id}`, undefined, 'GET')
    ).json()) as CharacterDetail;
    expect(
      (transferredDetail[cfg.kind] as unknown as Record<string, unknown>[])[0]?.[cfg.field],
    ).toBeNull();
    const transferValue = (await transferCopy.json()) as Record<string, { id: string }>;
    const transferredChild = transferValue[cfg.output]?.id;
    expect(
      (
        await request(
          gm.token,
          `/characters/${transferred.id}/${cfg.kind}/${transferredChild}`,
          { [cfg.field]: privateSource.id },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    // Cleanup from the old campaign must not detach a new campaign's live copy.
    await withAudit(gm.userId, null, (tx) =>
      detachLibraryReferencesForTransfer(tx, transferred.id, { campaignId: null }, campaign.id),
    );
    const retained = (await (
      await request(gm.token, `/characters/${transferred.id}`, undefined, 'GET')
    ).json()) as CharacterDetail;
    expect((retained[cfg.kind] as unknown as Record<string, unknown>[])[0]?.[cfg.field]).toBe(
      privateSource.id,
    );
  });
}
