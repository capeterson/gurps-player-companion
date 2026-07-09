/**
 * useCombatPatch — the shared ensure-row + outbox enqueue path for the
 * `character_combat` entity.  Verifies (via fake-indexeddb):
 *   1. a missing local combat row is materialized with the documented
 *      defaults before the patch applies, and the patch op lands in
 *      the outbox with the raw field value (AGENTS.md rule S2),
 *   2. an existing row is NOT re-materialized / clobbered by later
 *      patches on other fields.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { getLocalDb } from '../../../db/dexie.ts';
import { useCombatPatch } from './useCombatPatch.ts';

const CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000c0a7';

/**
 * The hook only reads `id`, `derived.hp`, `derived.fp` (and the outbox
 * only touches the combat row), so a focused partial cast keeps the
 * fixture honest about what the code under test depends on.
 */
function makeCharacter(hp = 10, fp = 12): CharacterDetail {
  return {
    id: CHAR_ID,
    derived: { hp, fp },
    combat: null,
  } as unknown as CharacterDetail;
}

describe('useCombatPatch', () => {
  it('materializes a default combat row when absent and enqueues the patch', async () => {
    const character = makeCharacter(10, 12);
    const { result } = renderHook(() => useCombatPatch(character));

    await result.current('currentHp', 42);

    const db = getLocalDb();
    const row = await db.characterCombat.get(CHAR_ID);
    expect(row).toBeDefined();
    // Materialized defaults (with the patched field applied on top).
    expect(row?.id).toBe(CHAR_ID);
    expect(row?.characterId).toBe(CHAR_ID);
    expect(row?.currentHp).toBe(42);
    expect(row?.currentFp).toBe(12);
    expect(row?.conditions).toEqual([]);
    expect(row?.maneuver).toBeNull();
    expect(row?.posture).toBe('standing');
    expect(row?.revision).toBe(-1);

    const ops = await db.outbox.toArray();
    expect(ops.length).toBe(1);
    expect(ops[0]?.entityClass).toBe('character_combat');
    expect(ops[0]?.entityId).toBe(CHAR_ID);
    expect(ops[0]?.command).toBe('patch');
    expect(ops[0]?.fieldPath).toBe('currentHp');
    // Raw field value, never a wrapped object (rule S2).
    expect(ops[0]?.attemptedValue).toBe(42);
    // prevValue captured from the freshly materialized default row so a
    // server rejection can revert cleanly.
    expect(ops[0]?.prevValue).toBe(10);
    expect(ops[0]?.status).toBe('pending');
  });

  it('does not clobber an existing combat row on subsequent patches', async () => {
    const character = makeCharacter(10, 12);
    const { result } = renderHook(() => useCombatPatch(character));

    await result.current('currentHp', 42);
    await result.current('currentFp', 3);

    const db = getLocalDb();
    const row = await db.characterCombat.get(CHAR_ID);
    // First patch survives — the second call must not re-materialize
    // the default row over it.
    expect(row?.currentHp).toBe(42);
    expect(row?.currentFp).toBe(3);

    const ops = await db.outbox.toArray();
    expect(ops.length).toBe(2);
    const fields = ops.map((o) => o.fieldPath).sort();
    expect(fields).toEqual(['currentFp', 'currentHp']);
  });
});
