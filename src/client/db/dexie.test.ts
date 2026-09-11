/**
 * Dexie v4 migration: local `characters` rows written by the
 * pre-redesign app still carry nonzero `tempSt`/`tempDx`/... scalar
 * fields and no `tempEffects`. Without this migration the adapters'
 * "default missing tempEffects to []" fallback would silently drop an
 * active boost in the offline UI until a cursor pull happened to
 * replace the row (PR #46 review finding).
 *
 * `migrateLegacyTempScalarsRow` is unit-tested directly (fast,
 * deterministic). The full Dexie upgrade chain is also exercised end
 * to end by seeding a raw pre-v4 database and then opening the real
 * `LocalDb` through `getLocalDb()`, which forces Dexie's versionchange
 * upgrade (including our v4 `.upgrade()` step) to run for real.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { readDrainableOps, resolveLegacyCampaignDependency } from '../sync/outbox.ts';
import { getLocalDb, migrateLegacyTempScalarsRow, resetLocalDb } from './dexie.ts';

const DB_NAME = 'gurps-pc-local';

it.each(['applied', 'rejected'] as const)(
  'v10 sequences an intermediate-campaign create when its prerequisite is %s',
  async (outcome) => {
    await resetLocalDb();
    const a = '0193b3c0-f1f0-7000-8000-000000000001';
    const b = '0193b3c0-f1f0-7000-8000-000000000002';
    const c = '0193b3c0-f1f0-7000-8000-000000000003';
    const source = '0193b3c0-f1f0-7000-8000-000000000004';
    const legacy = new Dexie(DB_NAME);
    legacy.version(9).stores({ outbox: 'clientOpId', characters: 'id', characterTraits: 'id' });
    await legacy.table('characters').put({ id: 'character', campaignId: c });
    await legacy.table('characterTraits').put({
      id: 'middle',
      name: 'Saved addition',
      revision: -1,
      libraryMechanics: { sourceId: source, campaignId: b, sourceRevision: 1, effects: [] },
    });
    const first = {
      clientOpId: 'first',
      entityId: 'character',
      entityClass: 'character',
      command: 'patch',
      fieldPath: 'campaignId',
      prevValue: a,
      attemptedValue: b,
      status: 'in_flight',
      enqueuedAt: '2026-09-10T00:00:00Z',
    };
    await legacy.table('outbox').bulkPut([
      first,
      {
        ...first,
        clientOpId: 'second',
        prevValue: b,
        attemptedValue: c,
        status: 'pending',
        enqueuedAt: '2026-09-10T00:00:02Z',
      },
      {
        clientOpId: 'middle',
        entityId: 'middle',
        parentId: 'character',
        entityClass: 'character_trait',
        command: 'create',
        attemptedValue: { libraryTraitId: source },
        status: 'pending',
        enqueuedAt: '2026-09-10T00:00:01Z',
      },
    ]);
    legacy.close();
    const db = getLocalDb();
    await db.open();
    expect((await db.outbox.get('middle'))?.localRequiredCampaignId).toBe(b);
    expect(await readDrainableOps(50)).toEqual([]);
    await db.outbox.update('first', { status: 'pending' });
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['first']);
    if (outcome === 'rejected') {
      await db.outbox.bulkDelete(['first', 'second']);
      await db.characters.update('character', { campaignId: a });
      expect(await readDrainableOps(50)).toEqual([]);
      expect((await db.outbox.get('middle'))?.localCampaignDependencyUnknown).toBe(true);
      expect((await db.characterTraits.get('middle'))?.name).toBe('Saved addition');
      await expect(resolveLegacyCampaignDependency('middle', true)).rejects.toThrow(
        /Move the character/,
      );
      await db.outbox.put({
        ...first,
        status: 'pending',
        coalesceKey: 'character|campaignId',
        validationVersion: 1,
        attemptCount: 0,
      } as never);
      await db.characters.update('character', { campaignId: b });
      await resolveLegacyCampaignDependency('middle', true);
      expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['first']);
    }
    await db.outbox.delete('first');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['middle']);
    db.close();
    await db.open();
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['middle']);
    await db.outbox.delete('middle');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(
      outcome === 'applied' ? ['second'] : [],
    );
  },
);

it.each(['pending', 'in_flight', 'transient_retry'] as const)(
  'v10 restores pre-upgrade create ordering around a %s campaign assignment',
  async (status) => {
    await resetLocalDb();
    const legacy = new Dexie(DB_NAME);
    legacy.version(9).stores({ outbox: 'clientOpId', characterTraits: 'id', characters: 'id' });
    await legacy.table('characters').put({ id: 'character', campaignId: 'B' });
    const create = (id: string, time: string, parentId = 'character') => ({
      clientOpId: id,
      entityId: id,
      parentId,
      entityClass: 'character_trait',
      command: 'create',
      status: 'pending',
      enqueuedAt: time,
      attemptedValue: { name: id, libraryTraitId: id },
    });
    await legacy.table('outbox').bulkPut([
      create('earlier', '2026-09-10T00:00:00.000Z'),
      {
        clientOpId: 'assignment',
        entityId: 'character',
        entityClass: 'character',
        command: 'patch',
        fieldPath: 'campaignId',
        prevValue: 'A',
        attemptedValue: 'B',
        status,
        enqueuedAt: '2026-09-10T00:00:01.000Z',
        localCampaignTransferUndo: [
          {
            store: 'characterTraits',
            entityId: 'earlier',
            campaignId: 'A',
            before: { libraryTraitId: 'earlier' },
            after: { libraryTraitId: null },
          },
        ],
      },
      create('later', '2026-09-10T00:00:02.000Z'),
      create('ambiguous', '2026-09-10T00:00:01.000Z'),
      create('unrelated', '2026-09-10T00:00:02.000Z', 'other'),
      {
        ...create('explicit', '2026-09-10T00:00:02.000Z'),
        localWaitForCampaignAssignment: false,
      },
    ]);
    await legacy
      .table('characterTraits')
      .put({ id: 'later', name: 'My unsaved trait', revision: -1 });
    legacy.close();
    const db = getLocalDb();
    await db.open();
    expect((await db.outbox.get('earlier'))?.localWaitForCampaignAssignment).toBe(false);
    expect((await db.outbox.get('later'))?.localWaitForCampaignAssignment).toBe(true);
    expect((await db.outbox.get('unrelated'))?.localWaitForCampaignAssignment).toBe(false);
    expect((await db.outbox.get('explicit'))?.localWaitForCampaignAssignment).toBe(false);
    expect((await db.characterTraits.get('later'))?.name).toBe('My unsaved trait');
    expect((await db.outbox.get('ambiguous'))?.localCampaignDependencyUnknown).toBe(true);
    expect((await readDrainableOps(50)).map((op) => op.clientOpId).sort()).toEqual([
      ...(status === 'in_flight' ? [] : ['earlier']),
      'explicit',
      'unrelated',
    ]);
    await db.outbox.update('assignment', { status: 'pending' });
    expect((await readDrainableOps(50)).map((op) => op.clientOpId).sort()).toEqual([
      'earlier',
      'explicit',
      'unrelated',
    ]);
    await db.outbox.bulkDelete(['earlier', 'explicit', 'unrelated']);
    // A request interrupted by upgrade is reset for replay at bootstrap.
    await db.outbox.update('assignment', { status: 'pending' });
    expect(await readDrainableOps(50)).toEqual([]);
    db.close();
    await db.open();
    expect((await db.outbox.get('ambiguous'))?.localCampaignDependencyUnknown).toBe(true);
    await resolveLegacyCampaignDependency('ambiguous', true);
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['assignment']);
    db.close();
    await db.open();
    expect((await db.outbox.get('later'))?.localWaitForCampaignAssignment).toBe(true);
    await db.outbox.delete('assignment');
    expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(['ambiguous', 'later']);
    expect((await db.outbox.get('later'))?.attemptedValue).toEqual({
      name: 'later',
      libraryTraitId: 'later',
    });
  },
);

it('v9 backfills only trait/skill declarations while retaining rows, pending edits and other cursors', async () => {
  await resetLocalDb();
  const legacy = new Dexie(DB_NAME);
  legacy.version(8).stores({
    characterTraits: 'id, characterId, [characterId+kind], updatedAt, revision',
    outbox: 'clientOpId',
    syncCursors: 'entityClass',
  });
  await legacy
    .table('characterTraits')
    .put({ id: 'trait', characterId: 'character', kind: 'advantage', name: 'Owned' });
  await legacy
    .table('outbox')
    .put({ clientOpId: 'pending', fieldPath: 'name', attemptedValue: 'My edit' });
  await legacy.table('syncCursors').bulkPut(
    ['character', 'character_trait', 'character_skill'].map((entityClass) => ({
      entityClass,
      revision: 20,
    })),
  );
  legacy.close();
  const db = getLocalDb();
  await db.open();
  expect(await db.syncCursors.toArray()).toEqual([{ entityClass: 'character', revision: 20 }]);
  expect((await db.characterTraits.get('trait'))?.name).toBe('Owned');
  expect((await db.outbox.get('pending'))?.attemptedValue).toBe('My edit');
  expect(
    await db.characterTraits.where('[characterId+kind]').equals(['character', 'advantage']).count(),
  ).toBe(1);
});

afterEach(async () => {
  await resetLocalDb();
});

describe('migrateLegacyTempScalarsRow', () => {
  it('synthesizes a manual effect from nonzero legacy scalars and drops the legacy keys', () => {
    const row: Record<string, unknown> = {
      id: 'c1',
      tempSt: 2,
      tempDx: 0,
      tempHpMod: -3,
      tempWillMod: 0,
    };
    migrateLegacyTempScalarsRow(row);
    expect(row.tempEffects).toEqual([
      { id: 'manual', name: 'Manual adjustment', mods: { st: 2, hp: -3 } },
    ]);
    expect(row.tempSt).toBeUndefined();
    expect(row.tempDx).toBeUndefined();
    expect(row.tempHpMod).toBeUndefined();
    expect(row.tempWillMod).toBeUndefined();
  });

  it('produces an empty array when every legacy scalar is zero or absent', () => {
    const row: Record<string, unknown> = { id: 'c2', tempSt: 0 };
    migrateLegacyTempScalarsRow(row);
    expect(row.tempEffects).toEqual([]);
    expect(row.tempSt).toBeUndefined();
  });

  it('covers every legacy axis mapping from migration 0017', () => {
    const row: Record<string, unknown> = {
      id: 'c3',
      tempSt: 1,
      tempDx: 2,
      tempIq: 3,
      tempHt: 4,
      tempHpMod: 5,
      tempWillMod: 6,
      tempPerMod: 7,
      tempFpMod: 8,
      tempSpeedQuarterMod: 9,
      tempMoveMod: 10,
    };
    migrateLegacyTempScalarsRow(row);
    expect(row.tempEffects).toEqual([
      {
        id: 'manual',
        name: 'Manual adjustment',
        mods: {
          st: 1,
          dx: 2,
          iq: 3,
          ht: 4,
          hp: 5,
          will: 6,
          per: 7,
          fp: 8,
          speedQuarter: 9,
          move: 10,
        },
      },
    ]);
  });

  it('leaves an already-migrated row (tempEffects present) untouched, but still sweeps legacy keys', () => {
    const existing = [{ id: 'e1', name: 'Might', mods: { st: 2 } }];
    const row: Record<string, unknown> = { id: 'c4', tempEffects: existing, tempSt: 5 };
    migrateLegacyTempScalarsRow(row);
    expect(row.tempEffects).toBe(existing);
    expect(row.tempSt).toBeUndefined();
  });
});

describe('LocalDb v4 upgrade (integration)', () => {
  it('migrates a legacy-shaped character row when the real LocalDb opens', async () => {
    // Seed a "pre-redesign" database at v3 -- mirrors dexie.ts's v1-v3
    // `.stores()` calls verbatim so the upgrade chain that `getLocalDb()`
    // triggers below is the real one, not a synthetic shortcut.
    const legacy = new Dexie(DB_NAME);
    legacy.version(1).stores({
      characters: 'id, ownerId, campaignId, updatedAt, revision',
      characterTraits: 'id, characterId, [characterId+kind], updatedAt, revision',
      characterSkills: 'id, characterId, updatedAt, revision',
      characterInventory: 'id, characterId, parentId, updatedAt, revision',
      characterCombat: 'characterId, revision',
      campaigns: 'id, ownerId, revision',
      outbox: 'clientOpId, status, coalesceKey, enqueuedAt, [status+enqueuedAt]',
      syncCursors: 'entityClass',
      syncMeta: 'key',
      tombstones: '[entityClass+entityId], revision',
      rejectionToasts: 'id, entityId, dismissedAt',
    });
    legacy.version(2).stores({
      characterSpells: 'id, characterId, updatedAt, revision',
    });
    legacy.version(3).stores({
      outbox: 'clientOpId, status, coalesceKey, enqueuedAt, entityId, [status+enqueuedAt]',
    });
    await legacy.open();
    await legacy.table('characters').put({
      id: 'legacy-char',
      ownerId: 'owner-1',
      campaignId: null,
      name: 'Legacy Hero',
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
      tempSt: 2,
      tempHpMod: -3,
      dismissedWarnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 3,
    });
    legacy.close();

    // Opening the real LocalDb (version 4) forces Dexie's versionchange
    // upgrade chain to run, including our v4 `.upgrade()` step.
    const db = getLocalDb();
    const row = (await db.characters.get('legacy-char')) as unknown as Record<string, unknown>;
    expect(row.tempEffects).toEqual([
      { id: 'manual', name: 'Manual adjustment', mods: { st: 2, hp: -3 } },
    ]);
    expect(row.tempSt).toBeUndefined();
    expect(row.tempHpMod).toBeUndefined();
    // Untouched fields survive the upgrade.
    expect(row.name).toBe('Legacy Hero');
  });
});
