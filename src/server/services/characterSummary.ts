/**
 * Server-side adapter around the shared `buildCharacterDetail` builder.
 *
 * The pure builder lives in `src/shared/domain/characterDetail.ts` so
 * the local-first client can compute derived stats / points /
 * warnings from raw Dexie rows the same way the server does from
 * Drizzle rows.  This file just maps Drizzle `Db*` row types onto the
 * builder's input shape.
 *
 * `loadCharacterDetail` is the single multi-table loader that fetches
 * a character plus every sub-resource it needs to build that detail —
 * it used to be duplicated byte-for-byte as `loadFullCharacter` in
 * routes/characters.ts and `refreshDetail` in
 * routes/characterSubResources.ts; both now call this instead.
 */

import { asc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CharacterAttrs } from '../../shared/domain/characterCalc.ts';
import {
  type CharacterDetailInput,
  buildCharacterDetail as buildCharacterDetailShared,
  buildCombatStateOut as buildCombatStateOutShared,
  buildInventoryItemOut as buildInventoryItemOutShared,
  buildSkillOut as buildSkillOutShared,
  buildSpellOut as buildSpellOutShared,
  buildTraitOut as buildTraitOutShared,
} from '../../shared/domain/characterDetail.ts';
import type { TraitEffect } from '../../shared/schemas/effects.ts';
import { getDb } from '../db/client.ts';
import {
  campaignLibrarySkills,
  campaignLibraryTraits,
  type DbCampaign,
  type DbCharacter,
  type DbCharacterSkill,
  type DbCharacterSpell,
  type DbCharacterTrait,
  type DbCombatState,
  type DbInventoryItem,
  campaigns,
  characterSkills,
  characterSpells,
  characterTraits,
  characters,
  combatStates,
  inventoryItems,
} from '../db/schema.ts';

export function characterAttrsFromRow(c: DbCharacter): CharacterAttrs {
  return {
    st: c.st,
    dx: c.dx,
    iq: c.iq,
    ht: c.ht,
    hpMod: c.hpMod,
    willMod: c.willMod,
    perMod: c.perMod,
    fpMod: c.fpMod,
    speedQuarterMod: c.speedQuarterMod,
    moveMod: c.moveMod,
    tempEffects: c.tempEffects ?? [],
    // Trait-effect deltas live on the shared input; populated by
    // buildCharacterDetail itself before computeDerived runs.
    dodgeMod: 0,
    parryMod: 0,
    blockMod: 0,
    drMod: 0,
    frightCheckMod: 0,
  };
}

export interface SummaryInput {
  readonly character: DbCharacter;
  readonly traits: readonly DbCharacterTrait[];
  readonly skills: readonly DbCharacterSkill[];
  readonly spells: readonly DbCharacterSpell[];
  readonly inventory: readonly DbInventoryItem[];
  readonly combat: DbCombatState | null;
  readonly campaign: DbCampaign | null;
  /**
   * Per-library-trait effect arrays, keyed by libraryTraitId.  Built by
   * the route handler from a single batched query against
   * campaign_library_traits.  Traits without a library reference (or
   * with libraryTraitId pointing at a deleted/missing entry) get an
   * empty effect list.
   */
  readonly libraryTraitEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
  readonly librarySkillEffects?: ReadonlyMap<string, ReadonlyArray<TraitEffect>>;
}

/**
 * Batch-fetch library trait/skill effect arrays for the trait/skill ids
 * referenced by a character's traits/skills.  Returns Maps keyed by
 * library row id.  Empty maps when no character record references a
 * library row (or when the referenced library rows have no effects).
 */
export async function fetchLibraryEffects(
  characterTraits: ReadonlyArray<DbCharacterTrait>,
  characterSkills: ReadonlyArray<DbCharacterSkill>,
): Promise<{
  libraryTraitEffects: Map<string, ReadonlyArray<TraitEffect>>;
  librarySkillEffects: Map<string, ReadonlyArray<TraitEffect>>;
}> {
  const db = getDb();
  const traitIds = Array.from(
    new Set(characterTraits.map((t) => t.libraryTraitId).filter((x): x is string => !!x)),
  );
  const skillIds = Array.from(
    new Set(characterSkills.map((s) => s.librarySkillId).filter((x): x is string => !!x)),
  );

  const [traitRows, skillRows] = await Promise.all([
    traitIds.length === 0
      ? Promise.resolve([] as { id: string; effects: unknown[] }[])
      : db
          .select({ id: campaignLibraryTraits.id, effects: campaignLibraryTraits.effects })
          .from(campaignLibraryTraits)
          .where(inArray(campaignLibraryTraits.id, traitIds)),
    skillIds.length === 0
      ? Promise.resolve([] as { id: string; effects: unknown[] }[])
      : db
          .select({ id: campaignLibrarySkills.id, effects: campaignLibrarySkills.effects })
          .from(campaignLibrarySkills)
          .where(inArray(campaignLibrarySkills.id, skillIds)),
  ]);

  const libraryTraitEffects = new Map<string, ReadonlyArray<TraitEffect>>();
  for (const r of traitRows) {
    libraryTraitEffects.set(r.id, (r.effects ?? []) as TraitEffect[]);
  }
  const librarySkillEffects = new Map<string, ReadonlyArray<TraitEffect>>();
  for (const r of skillRows) {
    librarySkillEffects.set(r.id, (r.effects ?? []) as TraitEffect[]);
  }

  return { libraryTraitEffects, librarySkillEffects };
}

export function buildCharacterDetail(input: SummaryInput) {
  const traitEffects = input.libraryTraitEffects;
  const skillEffects = input.librarySkillEffects;
  const adapted: CharacterDetailInput = {
    character: input.character,
    traits: input.traits.map((t) => ({
      ...t,
      libraryEffects:
        t.libraryTraitId && traitEffects?.has(t.libraryTraitId)
          ? [...(traitEffects.get(t.libraryTraitId) ?? [])]
          : [],
    })),
    skills: input.skills.map((s) => ({
      ...s,
      libraryEffects:
        s.librarySkillId && skillEffects?.has(s.librarySkillId)
          ? [...(skillEffects.get(s.librarySkillId) ?? [])]
          : [],
    })),
    spells: input.spells,
    inventory: input.inventory,
    combat: input.combat,
    campaign: input.campaign,
  };
  return buildCharacterDetailShared(adapted);
}

/**
 * Load a character plus every sub-resource `buildCharacterDetail` needs
 * (traits, skills, spells, inventory, combat state, parent campaign)
 * and build the detail payload.  This is the canonical "refresh the
 * character sheet" query set — every route that returns a
 * `characterDetail` after a read or a write calls this rather than
 * re-selecting the same six tables itself.
 */
export async function loadCharacterDetail(id: string) {
  const db = getDb();
  const [c] = await db.select().from(characters).where(eq(characters.id, id));
  if (!c) throw new HTTPException(404, { message: 'character not found' });
  const [traits, skills, spells, inventory, combat, campaign] = await Promise.all([
    db
      .select()
      .from(characterTraits)
      .where(eq(characterTraits.characterId, id))
      .orderBy(asc(characterTraits.kind), asc(characterTraits.name)),
    db
      .select()
      .from(characterSkills)
      .where(eq(characterSkills.characterId, id))
      .orderBy(asc(characterSkills.name)),
    db
      .select()
      .from(characterSpells)
      .where(eq(characterSpells.characterId, id))
      .orderBy(asc(characterSpells.name)),
    db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.characterId, id))
      .orderBy(asc(inventoryItems.name)),
    db
      .select()
      .from(combatStates)
      .where(eq(combatStates.characterId, id))
      .then((r) => r[0] ?? null),
    c.campaignId
      ? db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, c.campaignId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const { libraryTraitEffects, librarySkillEffects } = await fetchLibraryEffects(traits, skills);
  return buildCharacterDetail({
    character: c,
    traits,
    skills,
    spells,
    inventory,
    combat,
    campaign,
    libraryTraitEffects,
    librarySkillEffects,
  });
}

export const buildTraitOut = buildTraitOutShared;
export const buildCombatStateOut = buildCombatStateOutShared;
export const buildSkillOut = buildSkillOutShared;
export const buildSpellOut = buildSpellOutShared;
export const buildInventoryItemOut = buildInventoryItemOutShared;
