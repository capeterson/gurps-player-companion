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

import { and, asc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type CharacterDetailInput,
  buildCharacterDetail as buildCharacterDetailShared,
  buildCombatStateOut as buildCombatStateOutShared,
  buildLanguageOut as buildLanguageOutShared,
  buildTraitOut as buildTraitOutShared,
} from '../../shared/domain/characterDetail.ts';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import type { AuditTx } from '../db/auditContext.ts';
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
export async function loadCharacterDetail(
  id: string,
  db: ReturnType<typeof getDb> | AuditTx = getDb(),
) {
  const [c] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, id), isNull(characters.deletedAt)));
  if (!c) throw new HTTPException(404, { message: 'character not found' });
  // Delegated operations intentionally run the whole shared handler on one
  // transaction/connection. Keep these queries sequential; node-postgres does
  // not support concurrent query execution on a single client.
  const traits = await db
    .select()
    .from(characterTraits)
    .where(eq(characterTraits.characterId, id))
    .orderBy(asc(characterTraits.kind), asc(characterTraits.name));
  const skills = await db
    .select()
    .from(characterSkills)
    .where(eq(characterSkills.characterId, id))
    .orderBy(asc(characterSkills.name));
  const spells = await db
    .select()
    .from(characterSpells)
    .where(eq(characterSpells.characterId, id))
    .orderBy(asc(characterSpells.name));
  const languages = await db
    .select()
    .from(characterLanguages)
    .where(eq(characterLanguages.characterId, id))
    .orderBy(asc(characterLanguages.name));
  const techniques = await db
    .select()
    .from(characterTechniques)
    .where(eq(characterTechniques.characterId, id))
    .orderBy(asc(characterTechniques.name));
  const inventory = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.characterId, id))
    .orderBy(asc(inventoryItems.name));
  const combat =
    (await db.select().from(combatStates).where(eq(combatStates.characterId, id)))[0] ?? null;
  const campaign = c.campaignId
    ? ((await db.select().from(campaigns).where(eq(campaigns.id, c.campaignId)))[0] ?? null) // recycle-bin: a live character's own campaign is never binned
    : null;
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
export const buildLanguageOut = buildLanguageOutShared;
