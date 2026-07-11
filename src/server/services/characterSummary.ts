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
  buildSkillOut as buildSkillOutShared,
  buildSpellOut as buildSpellOutShared,
  buildTraitOut as buildTraitOutShared,
} from '../../shared/domain/characterDetail.ts';
import { getDb } from '../db/client.ts';
import {
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
    tempSt: c.tempSt,
    tempDx: c.tempDx,
    tempIq: c.tempIq,
    tempHt: c.tempHt,
    tempHpMod: c.tempHpMod,
    tempWillMod: c.tempWillMod,
    tempPerMod: c.tempPerMod,
    tempFpMod: c.tempFpMod,
    tempSpeedQuarterMod: c.tempSpeedQuarterMod,
    tempMoveMod: c.tempMoveMod,
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
}

export function buildCharacterDetail(input: SummaryInput) {
  const adapted: CharacterDetailInput = {
    character: input.character,
    traits: input.traits,
    skills: input.skills,
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
  return buildCharacterDetail({
    character: c,
    traits,
    skills,
    spells,
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
