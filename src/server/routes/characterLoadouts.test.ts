/**
 * Equipment loadouts through both doors (REST and /sync), the atomic switch,
 * the share gate and history batching. Requires the integration Postgres.
 */
import { describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { equipmentSwitch } from '../../shared/schemas/loadout.ts';
import { SYNC_PROTOCOL_HEADER, SYNC_PROTOCOL_VERSION } from '../../shared/syncProtocol.ts';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { characterLoadouts, entityHistory, inventoryItems } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import { createTestActor } from '../testFixtures.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

async function call<T = Record<string, unknown>>(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL_VERSION),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function ok<T = Record<string, unknown>>(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const result = await call<T>(token, path, method, body);
  if (result.status >= 300)
    throw new Error(`${method} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
}

interface Item {
  id: string;
  name: string;
  equipped: boolean;
  worn: boolean;
  parentId: string | null;
}

async function setup(label: string, campaignId?: string, token?: string) {
  const actor = token ? { accessToken: token } : await createTestActor(label);
  const character = await ok<{ id: string }>(actor.accessToken, '/characters', 'POST', {
    name: `Loadouts ${label}`,
    ...(campaignId ? { campaignId } : {}),
  });
  const add = async (body: Record<string, unknown>) =>
    (
      await ok<{ item: Item }>(
        actor.accessToken,
        `/characters/${character.id}/inventory`,
        'POST',
        body,
      )
    ).item;
  const sword = await add({ name: 'Sword', equipped: true });
  const shield = await add({ name: 'Shield', equipped: true });
  const chest = await add({ name: 'Chest', worn: false, isContainer: true });
  const bow = await add({ name: 'Bow', parentId: chest.id });
  return { token: actor.accessToken, characterId: character.id, sword, shield, chest, bow };
}

async function inventory(token: string, characterId: string) {
  const detail = await ok<{ inventory: Item[] }>(token, `/characters/${characterId}`);
  return new Map(detail.inventory.map((item) => [item.name, item]));
}

function op(fields: Record<string, unknown>) {
  return {
    clientOpId: crypto.randomUUID(),
    validationVersion: 1,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

async function sync(token: string, operations: unknown[]) {
  const result = await ok<{ outcomes: { status: string; reason?: string }[] }>(
    token,
    '/sync/operations',
    'POST',
    { operations },
  );
  return result.outcomes;
}

describe('equipment loadouts over REST', () => {
  it('creates, equips, restores and toggles Last Equipped atomically', async () => {
    const s = await setup('rest');
    const path = `/characters/${s.characterId}/loadouts`;
    const archery = await ok<{ id: string; sortOrder: number }>(s.token, path, 'POST', {
      name: 'Archery',
      itemIds: [s.bow.id],
    });
    const melee = await ok<{ id: string; sortOrder: number }>(s.token, path, 'POST', {
      name: 'Melee',
      itemIds: [s.sword.id, s.shield.id],
    });
    expect(melee.sortOrder).toBeGreaterThan(archery.sortOrder);

    const equipped = await ok<{
      lastEquipmentSwitch: unknown;
      character: { inventory: Item[] };
    }>(s.token, `${path}/${archery.id}/equip`, 'POST');
    const record = equipmentSwitch.parse(equipped.lastEquipmentSwitch);
    expect(record).toMatchObject({ kind: 'loadout', activeLoadoutName: 'Archery' });
    let items = await inventory(s.token, s.characterId);
    expect(items.get('Bow')).toMatchObject({ equipped: true, worn: true, parentId: null });
    expect(items.get('Sword')).toMatchObject({ equipped: false, worn: true });
    expect(items.get('Chest')).toMatchObject({ worn: false });

    // One switch is one audit batch spanning the character and every item.
    const history = await getDb()
      .select()
      .from(entityHistory)
      .where(eq(entityHistory.characterId, s.characterId));
    const switchRow = history.find(
      (row) =>
        row.entityClass === 'character' &&
        (row.newRow as Record<string, unknown> | null)?.last_equipment_switch,
    );
    expect(switchRow?.batchId).toBeTruthy();
    expect(
      history.filter(
        (row) => row.batchId === switchRow?.batchId && row.entityClass === 'character_inventory',
      ),
    ).toHaveLength(3);

    await ok(s.token, `${path}/restore-last-equipped`, 'POST');
    items = await inventory(s.token, s.characterId);
    expect(items.get('Bow')).toMatchObject({ equipped: false, parentId: s.chest.id });
    expect(items.get('Sword')?.equipped).toBe(true);
    await ok(s.token, `${path}/restore-last-equipped`, 'POST');
    items = await inventory(s.token, s.characterId);
    expect(items.get('Bow')).toMatchObject({ equipped: true, parentId: null });

    const listed = await ok<{ loadouts: { name: string }[]; lastEquipmentSwitch: unknown }>(
      s.token,
      path,
    );
    expect(listed.loadouts.map((loadout) => loadout.name)).toEqual(['Archery', 'Melee']);
    expect(equipmentSwitch.parse(listed.lastEquipmentSwitch).activeLoadoutId).toBe(archery.id);

    await ok(s.token, `${path}/${melee.id}`, 'PATCH', { name: 'Duel', sortOrder: -1 });
    const reordered = await ok<{ loadouts: { name: string }[] }>(s.token, path);
    expect(reordered.loadouts.map((loadout) => loadout.name)).toEqual(['Duel', 'Archery']);
    await ok(s.token, `${path}/${melee.id}`, 'DELETE');
    expect((await call(s.token, `${path}/${melee.id}/equip`, 'POST')).status).toBe(404);
  });

  it('refuses items from another character and writes by non-owners', async () => {
    const mine = await setup('own');
    const theirs = await setup('foreign');
    const path = `/characters/${mine.characterId}/loadouts`;
    const foreign = await call(mine.token, path, 'POST', { name: 'X', itemIds: [theirs.bow.id] });
    expect(foreign.status).toBe(400);
    expect((await call(theirs.token, path, 'POST', { name: 'X' })).status).toBe(403);
    expect((await call(theirs.token, path)).status).toBe(403);
  });
});

describe('equipment loadouts over /sync', () => {
  it('applies loadout ops and one atomic switch; refuses a stale switch without partial writes', async () => {
    const s = await setup('sync');
    const loadoutId = crypto.randomUUID();
    const [created, patched] = await sync(s.token, [
      op({
        entityClass: 'character_loadout',
        entityId: loadoutId,
        command: 'create',
        parentId: s.characterId,
        attemptedValue: { name: 'Archery', itemIds: [], sortOrder: 0, characterId: s.characterId },
      }),
      op({
        entityClass: 'character_loadout',
        entityId: loadoutId,
        command: 'patch',
        parentId: s.characterId,
        fieldPath: 'itemIds',
        attemptedValue: [s.bow.id.toUpperCase()],
      }),
    ]);
    expect([created?.status, patched?.status]).toEqual(['applied', 'applied']);
    const [row] = await getDb()
      .select()
      .from(characterLoadouts)
      .where(eq(characterLoadouts.id, loadoutId));
    expect(row?.itemIds).toEqual([s.bow.id]);

    const before = { equipped: false, worn: false, parentId: s.chest.id, externalLocation: null };
    const record = {
      kind: 'loadout',
      activeLoadoutId: loadoutId,
      activeLoadoutName: 'Archery',
      previousActiveLoadoutId: null,
      previousActiveLoadoutName: null,
      switchedAt: new Date().toISOString(),
      previousEquippedIds: [s.sword.id, s.shield.id],
      changes: [
        {
          itemId: s.bow.id,
          before,
          after: { equipped: true, worn: true, parentId: null, externalLocation: null },
        },
        {
          itemId: s.sword.id,
          before: { equipped: true, worn: true, parentId: null, externalLocation: null },
          after: { equipped: false, worn: true, parentId: null, externalLocation: null },
        },
      ],
    };
    const switchOp = () =>
      op({
        entityClass: 'character',
        entityId: s.characterId,
        command: 'patch',
        fieldPath: 'lastEquipmentSwitch',
        attemptedValue: record,
      });
    expect((await sync(s.token, [switchOp()]))[0]?.status).toBe('applied');
    // A replay of the same committed switch is acknowledged, not refused.
    expect((await sync(s.token, [switchOp()]))[0]?.status).toBe('applied');

    // Planned against the pre-switch inventory (as by another device): its
    // `before` values no longer hold, so nothing of it may apply.
    const conflicting = {
      ...record,
      switchedAt: new Date(Date.now() + 1000).toISOString(),
    };
    const refused = await sync(s.token, [
      op({
        entityClass: 'character',
        entityId: s.characterId,
        command: 'patch',
        fieldPath: 'lastEquipmentSwitch',
        attemptedValue: conflicting,
      }),
    ]);
    expect(refused[0]).toMatchObject({ status: 'rejected' });
    expect(refused[0]?.reason).toContain('changed on another device');
    const [bow] = await getDb()
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, s.bow.id)));
    expect(bow).toMatchObject({ equipped: true, parentId: null });
  });

  it('applies the same write guards as REST', async () => {
    const mine = await setup('sync-own');
    const theirs = await setup('sync-foreign');
    const [foreign] = await sync(mine.token, [
      op({
        entityClass: 'character_loadout',
        entityId: crypto.randomUUID(),
        command: 'create',
        parentId: mine.characterId,
        attemptedValue: { name: 'X', itemIds: [theirs.bow.id], sortOrder: 0 },
      }),
    ]);
    expect(foreign?.status).toBe('rejected');
    const [intruder] = await sync(theirs.token, [
      op({
        entityClass: 'character_loadout',
        entityId: crypto.randomUUID(),
        command: 'create',
        parentId: mine.characterId,
        attemptedValue: { name: 'X', itemIds: [], sortOrder: 0 },
      }),
    ]);
    expect(intruder?.status).toBe('unauthorized');
    const [offPlayer] = await sync(mine.token, [
      op({
        entityClass: 'character',
        entityId: mine.characterId,
        command: 'patch',
        fieldPath: 'lastEquipmentSwitch',
        attemptedValue: {
          kind: 'loadout',
          activeLoadoutId: null,
          activeLoadoutName: null,
          previousActiveLoadoutId: null,
          previousActiveLoadoutName: null,
          switchedAt: new Date().toISOString(),
          previousEquippedIds: [mine.sword.id, mine.shield.id],
          changes: [
            {
              itemId: mine.bow.id,
              before: {
                equipped: false,
                worn: false,
                parentId: mine.chest.id,
                externalLocation: null,
              },
              after: {
                equipped: true,
                worn: false,
                parentId: mine.chest.id,
                externalLocation: null,
              },
            },
          ],
        },
      }),
    ]);
    expect(offPlayer).toMatchObject({ status: 'rejected' });
  });
});

describe('equipment loadouts and the share gate', () => {
  it('hides loadouts and Last Equipped from a minimal-view member', async () => {
    const gm = await createTestActor('loadout-gm');
    const player = await createTestActor('loadout-player');
    const viewer = await createTestActor('loadout-viewer');
    const campaign = await ok<{ id: string }>(gm.accessToken, '/campaigns', 'POST', {
      name: `Loadout gate ${crypto.randomUUID()}`,
      shareCharacterSheets: false,
    });
    for (const member of [player, viewer])
      await ok(gm.accessToken, `/campaigns/${campaign.id}/members`, 'POST', {
        email: member.email,
      });
    const s = await setup('gate', campaign.id, player.accessToken);
    const path = `/characters/${s.characterId}/loadouts`;
    const loadout = await ok<{ id: string }>(s.token, path, 'POST', {
      name: 'Secret',
      itemIds: [s.bow.id],
    });
    await ok(s.token, `${path}/${loadout.id}/equip`, 'POST');

    expect((await call(viewer.accessToken, path)).status).toBe(403);
    expect((await call(gm.accessToken, path)).status).toBe(200);
    const cursor = await ok<{
      changes: { entityClass: string; entityId: string; data?: Record<string, unknown> }[];
    }>(viewer.accessToken, '/sync/cursor', 'POST', {
      cursors: [
        { entityClass: 'character', sinceRevision: 0 },
        { entityClass: 'character_loadout', sinceRevision: 0 },
      ],
    });
    expect(cursor.changes.some((change) => change.entityClass === 'character_loadout')).toBe(false);
    const characterRow = cursor.changes.find((change) => change.entityId === s.characterId);
    expect(characterRow?.data?.lastEquipmentSwitch).toBeNull();
    expect((await call(viewer.accessToken, `/characters/${s.characterId}/history`)).status).toBe(
      403,
    );
  });
});
