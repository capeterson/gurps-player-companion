/**
 * Equipment loadouts through the outbox (AGENTS.md S1/S4/S5/S11): a switch is
 * one ordered operation that changes many inventory rows locally, never
 * coalesces, holds its items against stale cursor rows and rolls every item
 * back with a toast and flashes when the server refuses it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationEnvelope } from '../../shared/schemas/sync.ts';
import { type LocalCharacterInventory, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import {
  equipLoadout,
  restoreLastEquipped,
  setLoadoutItem,
} from '../features/characters/sections/inventory/loadoutMutations.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { type FlashEvent, flashBus } from './flashBus.ts';
import {
  getSyncOrchestrator,
  resetSyncOrchestratorForTests,
  setRejectionNotifier,
} from './orchestrator.ts';
import { enqueueCreate, enqueueFieldPatch, readDrainableOps } from './outbox.ts';
import { syncStateStore } from './state.ts';

const CHARACTER = '0193b3c0-f1f0-7000-8000-00000000e001';
const SWORD = '0193b3c0-f1f0-7000-8000-00000000e011';
const BOW = '0193b3c0-f1f0-7000-8000-00000000e012';
const CHEST = '0193b3c0-f1f0-7000-8000-00000000e013';
const MELEE = '0193b3c0-f1f0-7000-8000-00000000e021';
const ARCHERY = '0193b3c0-f1f0-7000-8000-00000000e022';

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

type Outcome = Record<string, unknown>;

function stubServer(
  respond: (ops: OperationEnvelope[]) => Promise<Outcome[]> | Outcome[],
  cursor: () => unknown[] = () => [],
) {
  const sent: OperationEnvelope[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/sync/operations')) {
        const { operations } = JSON.parse(String(init?.body)) as {
          operations: OperationEnvelope[];
        };
        sent.push(operations);
        return json({ outcomes: await respond(operations) });
      }
      return json({ changes: cursor(), nextCursor: {}, hasMore: {} });
    }),
  );
  return sent;
}

function drain(): Promise<number | undefined> {
  return (
    getSyncOrchestrator() as unknown as { maybeDrainOnce(): Promise<number | undefined> }
  ).maybeDrainOnce();
}

function login() {
  tokenStore.write({
    accessToken: jwtForUser('owner'),
    refreshToken: 'refresh',
    accessTokenExpiresIn: 0,
  });
  getSyncOrchestrator().setCurrentUser('owner');
}

function row(
  id: string,
  name: string,
  patch: Partial<LocalCharacterInventory> = {},
): LocalCharacterInventory {
  return {
    id,
    characterId: CHARACTER,
    name,
    quantity: 1,
    weightLbs: 1,
    cost: 1,
    notes: null,
    parentId: null,
    externalLocation: null,
    worn: true,
    equipped: false,
    isContainer: false,
    hideawayCapacityLbs: 0,
    weightReductionPercent: 0,
    isArmor: false,
    armor: null,
    weaponData: null,
    powerstoneData: null,
    magicItemData: null,
    enchantments: [],
    libraryItemId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 3,
    ...patch,
  };
}

async function seed() {
  const db = getLocalDb();
  await db.characters.put({
    id: CHARACTER,
    ownerId: 'owner',
    campaignId: null,
    name: 'Ash',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    dismissedWarnings: [],
    activeConditionGroups: [],
    lastEquipmentSwitch: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 7,
  });
  await db.characterInventory.bulkPut([
    row(SWORD, 'Sword', { equipped: true }),
    row(CHEST, 'Chest', { worn: false, isContainer: true }),
    row(BOW, 'Bow', { parentId: CHEST, worn: false }),
  ]);
  await db.characterLoadouts.bulkPut([
    {
      id: MELEE,
      characterId: CHARACTER,
      name: 'Melee',
      itemIds: [SWORD],
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 4,
    },
    {
      id: ARCHERY,
      characterId: CHARACTER,
      name: 'Archery',
      itemIds: [BOW],
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 4,
    },
  ]);
}

const archery = { id: ARCHERY, name: 'Archery', itemIds: [BOW] };
const melee = { id: MELEE, name: 'Melee', itemIds: [SWORD] };

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setRejectionNotifier(null);
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  syncStateStore.reset('synced');
  await resetLocalDb();
});

describe('equipment switch outbox path', () => {
  it('applies every item locally and sends one switch operation', async () => {
    login();
    await seed();
    const db = getLocalDb();
    const plan = await equipLoadout(CHARACTER, archery);
    expect(plan.record.changes).toHaveLength(2);
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      equipped: true,
      worn: true,
      parentId: null,
    });
    expect(await db.characterInventory.get(SWORD)).toMatchObject({ equipped: false, worn: true });
    expect((await db.characters.get(CHARACTER))?.lastEquipmentSwitch).toMatchObject({
      activeLoadoutId: ARCHERY,
    });
    const sent = stubServer((ops) =>
      ops.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 20 })),
    );

    await drain();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]?.[0]).toMatchObject({
      entityClass: 'character',
      entityId: CHARACTER,
      command: 'patch',
      fieldPath: 'lastEquipmentSwitch',
    });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.characters.get(CHARACTER))?.revision).toBe(20);
    expect(syncStateStore.value).toBe('synced');
  });

  it('never coalesces switches and replays them in order with inventory edits', async () => {
    login();
    await seed();
    const db = getLocalDb();
    await enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: SWORD,
      characterId: CHARACTER,
      fieldPath: 'name',
      attemptedValue: 'Longsword',
    });
    await equipLoadout(CHARACTER, archery);
    await restoreLastEquipped(CHARACTER);
    await enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: BOW,
      characterId: CHARACTER,
      fieldPath: 'name',
      attemptedValue: 'Longbow',
    });
    const ops = await db.outbox.orderBy('enqueuedAt').toArray();
    expect(ops.map((op) => op.fieldPath)).toEqual([
      'name',
      'lastEquipmentSwitch',
      'lastEquipmentSwitch',
      'name',
    ]);
    // Each switch waits for the earlier operation; the later edit waits for the switches.
    expect((await readDrainableOps(50)).map((op) => op.entityId)).toEqual([SWORD]);
    const sent = stubServer((batch) =>
      batch.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 30 })),
    );
    for (let attempt = 0; attempt < 4; attempt += 1) await drain();
    expect(sent.map((batch) => batch.map((op) => op.fieldPath))).toEqual([
      ['name'],
      ['lastEquipmentSwitch'],
      ['lastEquipmentSwitch'],
      ['name'],
    ]);
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      name: 'Longbow',
      parentId: CHEST,
      equipped: false,
    });
  });

  it('rolls every item back with a toast and flashes, withdrawing later switches', async () => {
    login();
    await seed();
    const db = getLocalDb();
    await equipLoadout(CHARACTER, archery);
    await equipLoadout(CHARACTER, melee);
    // A later edit of the bow keeps its value and inherits the restored baseline.
    await enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId: BOW,
      characterId: CHARACTER,
      fieldPath: 'worn',
      attemptedValue: false,
    });
    const notices: string[] = [];
    setRejectionNotifier((record) => notices.push(`${record.humanName}: ${record.reason}`));
    const flashes: FlashEvent[] = [];
    const unsubscribe = flashBus.subscribePrefix('', (event) => flashes.push(event));
    await db.syncCursors.put({ entityClass: 'character_inventory', sinceRevision: 99 } as never);
    stubServer((ops) =>
      ops.map((op) => ({
        clientOpId: op.clientOpId,
        status: 'rejected',
        reason: "Couldn't switch equipment: the inventory changed on another device",
      })),
    );

    await drain();
    unsubscribe();

    expect(notices).toEqual([
      "Equip Archery: Couldn't switch equipment: the inventory changed on another device",
    ]);
    expect(await db.characterInventory.get(SWORD)).toMatchObject({ equipped: true });
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      equipped: false,
      parentId: CHEST,
      worn: false,
    });
    const remaining = await db.outbox.toArray();
    expect(remaining.map((op) => op.fieldPath)).toEqual(['worn']);
    expect(remaining[0]?.prevValue).toBe(false);
    expect((await db.characters.get(CHARACTER))?.lastEquipmentSwitch).toBeNull();
    expect(flashes.map((event) => event.key)).toEqual(
      expect.arrayContaining([
        `character_inventory:${SWORD}:equipped`,
        `character:${CHARACTER}:lastEquipmentSwitch`,
      ]),
    );
    // The server state moved on: the affected classes are pulled again.
    expect(await db.syncCursors.get('character_inventory')).toBeUndefined();
  });

  it('keeps switched fields while the switch is pending (S4)', async () => {
    login();
    await seed();
    const db = getLocalDb();
    await equipLoadout(CHARACTER, archery);
    stubServer(
      () => new Promise<Outcome[]>(() => {}),
      () => [
        {
          entityClass: 'character_inventory',
          entityId: BOW,
          command: 'patch',
          revision: 9,
          data: { ...row(BOW, 'Bow (server)', { parentId: CHEST, worn: false }), revision: 9 },
        },
      ],
    );
    await getSyncOrchestrator().triggerCursorPull();
    expect(await db.characterInventory.get(BOW)).toMatchObject({
      name: 'Bow (server)',
      parentId: null,
      worn: true,
      equipped: true,
      revision: 9,
    });
  });
});

describe('character_loadout outbox path', () => {
  it('creates a loadout and serializes rapid checklist toggles', async () => {
    login();
    await seed();
    const db = getLocalDb();
    const id = '0193b3c0-f1f0-7000-8000-00000000e031';
    await enqueueCreate({
      entityClass: 'character_loadout',
      entityId: id,
      characterId: CHARACTER,
      attemptedValue: { name: 'Travel', itemIds: [], sortOrder: 2, characterId: CHARACTER },
    });
    await Promise.all([setLoadoutItem(id, SWORD, true), setLoadoutItem(id, BOW, true)]);
    expect((await db.characterLoadouts.get(id))?.itemIds.sort()).toEqual([BOW, SWORD].sort());
    let release: (outcomes: Outcome[]) => void = () => {};
    const sent = stubServer((ops) =>
      sent.length === 1
        ? new Promise<Outcome[]>((resolve) => {
            release = resolve;
          })
        : ops.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 41 })),
    );
    const first = drain();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // A slow save: a later toggle of the same field queues behind it.
    await setLoadoutItem(id, SWORD, false);
    release(
      sent[0]?.map((op) => ({ clientOpId: op.clientOpId, status: 'applied', newRevision: 40 })) ??
        [],
    );
    await first;
    await drain();
    expect(sent.at(-1)?.[0]).toMatchObject({ fieldPath: 'itemIds', attemptedValue: [BOW] });
    expect((await db.characterLoadouts.get(id))?.itemIds).toEqual([BOW]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('rolls back a refused rename with a toast and a flash', async () => {
    login();
    await seed();
    const db = getLocalDb();
    const notices: string[] = [];
    setRejectionNotifier((record) => notices.push(record.humanName ?? ''));
    const flashes: string[] = [];
    const unsubscribe = flashBus.subscribe(`character_loadout:${MELEE}:name`, (event) =>
      flashes.push(event.reason),
    );
    await enqueueFieldPatch({
      entityClass: 'character_loadout',
      entityId: MELEE,
      characterId: CHARACTER,
      fieldPath: 'name',
      attemptedValue: 'Duel',
      humanName: 'Loadout name',
      flashKey: `character_loadout:${MELEE}:name`,
    });
    stubServer((ops) =>
      ops.map((op) => ({ clientOpId: op.clientOpId, status: 'rejected', reason: 'denied' })),
    );
    await drain();
    unsubscribe();
    expect((await db.characterLoadouts.get(MELEE))?.name).toBe('Melee');
    expect(notices).toEqual(['Loadout name']);
    expect(flashes).toEqual(['denied']);
  });
});
