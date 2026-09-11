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

import { asc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CharacterAttrs } from '../../shared/domain/characterCalc.ts';
import {
  type CharacterDetailInput,
  buildCharacterDetail as buildCharacterDetailShared,
  buildCombatStateOut as buildCombatStateOutShared,
  buildInventoryItemOut as buildInventoryItemOutShared,
  buildLanguageOut as buildLanguageOutShared,
  buildSkillOut as buildSkillOutShared,
  buildSpellOut as buildSpellOutShared,
  buildTechniqueOut as buildTechniqueOutShared,
  buildTraitOut as buildTraitOutShared,
} from '../../shared/domain/characterDetail.ts';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import { getDb } from '../db/client.ts';
import {
  type DbCampaign,
  type DbCharacter,
  type DbCharacterLanguage,
  type DbCharacterSkill,
  type DbCharacterSpell,
  type DbCharacterTechnique,
  type DbCharacterTrait,
  type DbCombatState,
  type DbInventoryItem,
  campaigns,
  characterLanguages,
  characterSkills,
  characterSpells,
  characterTechniques,
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
  readonly languages: readonly DbCharacterLanguage[];
  readonly techniques: readonly DbCharacterTechnique[];
  readonly inventory: readonly DbInventoryItem[];
  readonly combat: DbCombatState | null;
  readonly campaign: DbCampaign | null;
}

export function buildCharacterDetail(input: SummaryInput) {
  let libraryEffectsKnown = true;
  const effects = (id: string | null, snapshot: unknown) => {
    const value = ownedLibraryEffects(id, input.character.campaignId, snapshot);
    if (value === null) libraryEffectsKnown = false;
    return value ?? [];
  };
  const adapted: CharacterDetailInput = {
    character: input.character,
    traits: input.traits.map((t) => ({
      ...t,
      libraryEffects: effects(t.libraryTraitId, t.libraryMechanics),
    })),
    skills: input.skills.map((s) => ({
      ...s,
      libraryEffects: effects(s.librarySkillId, s.libraryMechanics),
    })),
    spells: input.spells,
    languages: input.languages,
    techniques: input.techniques,
    inventory: input.inventory,
    combat: input.combat,
    campaign: input.campaign,
  };
  return { ...buildCharacterDetailShared(adapted), libraryEffectsKnown };
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
  const [traits, skills, spells, languages, techniques, inventory, combat, campaign] =
    await Promise.all([
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
        .from(characterLanguages)
        .where(eq(characterLanguages.characterId, id))
        .orderBy(asc(characterLanguages.name)),
      db
        .select()
        .from(characterTechniques)
        .where(eq(characterTechniques.characterId, id))
        .orderBy(asc(characterTechniques.name)),
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
  return buildCharacterDetail({
    character: c,
    traits,
    skills,
    spells,
    languages,
    techniques,
    inventory,
    combat,
    campaign,
  });
}

export const buildTraitOut = buildTraitOutShared;
export const buildCombatStateOut = buildCombatStateOutShared;
export const buildSkillOut = buildSkillOutShared;
export const buildSpellOut = buildSpellOutShared;
export const buildInventoryItemOut = buildInventoryItemOutShared;
export const buildLanguageOut = buildLanguageOutShared;
export const buildTechniqueOut = buildTechniqueOutShared;
