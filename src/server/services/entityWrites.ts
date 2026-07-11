/**
 * Shared insert/upsert-values builders for the character-family entities.
 *
 * Contract: every character-family insert mapping lives here; REST and
 * sync both consume it (AGENTS.md S12 — "Sync and REST are two doors to
 * the same rows, keep their guards identical"). A column that's added to
 * one `.values({...})` call and not the other is a real bug class this
 * file exists to close off: REST (`characters.ts`,
 * `characterSubResources.ts`) and the `/sync/operations` dispatcher
 * (`syncDispatch.ts`) both call these builders instead of hand-rolling
 * their own copy of the mapping.
 *
 * Each builder's return type is pinned to the Drizzle table's
 * `$inferInsert`, so a future column addition to the table fails the
 * typecheck here — in one place — rather than silently insert-ing NULL
 * (or the column's default) on whichever of the two call sites forgot
 * to add it.
 *
 * Where REST and sync genuinely differ today (an optional client-supplied
 * `id` on sync creates so the local Dexie row keeps its identity; REST
 * lets the DB default the uuid), the difference is an explicit `id?`
 * option on the builder's `ctx` — not silently unified. Preserve that
 * shape when extending these builders.
 */

import type { Posture } from '../../shared/constants/combat.ts';
import type { CharacterCreate } from '../../shared/schemas/character.ts';
import type { InventoryItemCreate } from '../../shared/schemas/inventory.ts';
import type { SkillCreate } from '../../shared/schemas/skill.ts';
import type { SpellCreate } from '../../shared/schemas/spell.ts';
import type { TraitCreate } from '../../shared/schemas/trait.ts';
import type {
  characterSkills,
  characterSpells,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';

/**
 * Values for a new `characters` row.
 *
 * `ctx.id`: sync creates honor a client-supplied id so the local Dexie
 * row keeps its identity after the create round-trips (the unique index
 * turns a collision into a conflict via `isUniqueViolation`). REST lets
 * the DB default the uuid, so `ctx.id` is omitted there.
 */
export function characterInsertValues(
  body: CharacterCreate,
  ctx: { readonly ownerId: string; readonly id?: string },
): typeof characters.$inferInsert {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    ownerId: ctx.ownerId,
    campaignId: body.campaignId ?? null,
    name: body.name,
    playerName: body.playerName ?? null,
    height: body.height ?? null,
    weight: body.weight ?? null,
    age: body.age ?? null,
    appearance: body.appearance ?? null,
    techLevel: body.techLevel ?? null,
    st: body.st,
    dx: body.dx,
    iq: body.iq,
    ht: body.ht,
    hpMod: body.hpMod,
    willMod: body.willMod,
    perMod: body.perMod,
    fpMod: body.fpMod,
    speedQuarterMod: body.speedQuarterMod,
    moveMod: body.moveMod,
    tempSt: body.tempSt,
    tempDx: body.tempDx,
    tempIq: body.tempIq,
    tempHt: body.tempHt,
    tempHpMod: body.tempHpMod,
    tempWillMod: body.tempWillMod,
    tempPerMod: body.tempPerMod,
    tempFpMod: body.tempFpMod,
    tempSpeedQuarterMod: body.tempSpeedQuarterMod,
    tempMoveMod: body.tempMoveMod,
  };
}

/** Values for a new `character_traits` row. See `characterInsertValues` re: `ctx.id`. */
export function traitInsertValues(
  body: TraitCreate,
  ctx: { readonly characterId: string; readonly id?: string },
): typeof characterTraits.$inferInsert {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    characterId: ctx.characterId,
    kind: body.kind,
    name: body.name,
    points: body.points ?? 0,
    level: body.level ?? null,
    notes: body.notes ?? null,
    modifiers: body.modifiers ?? [],
    libraryTraitId: body.libraryTraitId ?? null,
  };
}

/** Values for a new `character_skills` row. See `characterInsertValues` re: `ctx.id`. */
export function skillInsertValues(
  body: SkillCreate,
  ctx: { readonly characterId: string; readonly id?: string },
): typeof characterSkills.$inferInsert {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    characterId: ctx.characterId,
    name: body.name,
    attribute: body.attribute,
    difficulty: body.difficulty,
    points: body.points ?? 1,
    techLevel: body.techLevel ?? null,
    specialization: body.specialization ?? null,
    notes: body.notes ?? null,
    librarySkillId: body.librarySkillId ?? null,
  };
}

/** Values for a new `character_spells` row. See `characterInsertValues` re: `ctx.id`. */
export function spellInsertValues(
  body: SpellCreate,
  ctx: { readonly characterId: string; readonly id?: string },
): typeof characterSpells.$inferInsert {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    characterId: ctx.characterId,
    name: body.name,
    college: body.college ?? null,
    difficulty: body.difficulty ?? 'H',
    points: body.points ?? 1,
    baseEnergyCost: body.baseEnergyCost ?? 1,
    maintenanceCost: body.maintenanceCost ?? null,
    castingTime: body.castingTime ?? null,
    duration: body.duration ?? null,
    prerequisites: body.prerequisites ?? null,
    notes: body.notes ?? null,
    librarySpellId: body.librarySpellId ?? null,
  };
}

/**
 * Values for a new `inventory_items` row. See `characterInsertValues` re:
 * `ctx.id`. Decimal columns (`weightLbs`, `cost`, `hideawayCapacityLbs`)
 * are stringified: Drizzle's `numeric` mapping expects a string, not a
 * `number`, for both paths.
 */
export function inventoryInsertValues(
  body: InventoryItemCreate,
  ctx: { readonly characterId: string; readonly id?: string },
): typeof inventoryItems.$inferInsert {
  return {
    ...(ctx.id ? { id: ctx.id } : {}),
    characterId: ctx.characterId,
    name: body.name,
    quantity: body.quantity ?? 1,
    weightLbs: String(body.weightLbs ?? 0),
    cost: String(body.cost ?? 0),
    notes: body.notes ?? null,
    parentId: body.parentId ?? null,
    externalLocation: body.externalLocation ?? null,
    worn: body.worn ?? false,
    equipped: body.equipped ?? false,
    isContainer: body.isContainer ?? false,
    hideawayCapacityLbs: String(body.hideawayCapacityLbs ?? 0),
    weightReductionPercent: body.weightReductionPercent ?? 0,
    isArmor: body.isArmor ?? false,
    armor: body.armor ?? null,
    weaponData: body.weaponData ?? null,
    powerstoneData: body.powerstoneData ?? null,
    magicItemData: body.magicItemData ?? null,
    libraryItemId: body.libraryItemId ?? null,
  };
}

/**
 * Values for the `combat_states` upsert-insert branch (the row created
 * the first time a character's combat state is touched; the
 * `onConflictDoUpdate` branch is `buildPatchSet(body)` at both call
 * sites already, so it isn't duplicated here). `derived.hp` / `derived.fp`
 * — the character's computed HP/FP — are the defaults when the caller
 * didn't send `currentHp` / `currentFp`, so a first-touch combat row
 * (e.g. a field-path patch spending FP on a character with no combat row
 * yet) starts from the character's real pools instead of the column
 * default of 10.
 */
export function combatUpsertValues(
  body: Record<string, unknown>,
  ctx: {
    readonly characterId: string;
    readonly derived: { readonly hp: number; readonly fp: number };
  },
): typeof combatStates.$inferInsert {
  return {
    characterId: ctx.characterId,
    currentHp: (body.currentHp as number | undefined) ?? ctx.derived.hp,
    currentFp: (body.currentFp as number | undefined) ?? ctx.derived.fp,
    conditions: (body.conditions as string[] | undefined) ?? [],
    maneuver: (body.maneuver as string | null | undefined) ?? null,
    posture: (body.posture as Posture | undefined) ?? 'standing',
  };
}
