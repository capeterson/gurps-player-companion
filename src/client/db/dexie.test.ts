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
import { getLocalDb, migrateLegacyTempScalarsRow, resetLocalDb } from './dexie.ts';

const DB_NAME = 'gurps-pc-local';

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
