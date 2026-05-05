/**
 * Server-side adapter around the shared `buildCharacterDetail` builder.
 *
 * The pure builder lives in `src/shared/domain/characterDetail.ts` so
 * the local-first client can compute derived stats / points /
 * warnings from raw Dexie rows the same way the server does from
 * Drizzle rows.  This file just maps Drizzle `Db*` row types onto the
 * builder's input shape.
 */

import type { CharacterAttrs } from '../../shared/domain/characterCalc.ts';
import {
  type CharacterDetailInput,
  buildCharacterDetail as buildCharacterDetailShared,
  buildCombatStateOut as buildCombatStateOutShared,
  buildInventoryItemOut as buildInventoryItemOutShared,
  buildSkillOut as buildSkillOutShared,
  buildTraitOut as buildTraitOutShared,
} from '../../shared/domain/characterDetail.ts';
import type {
  DbCampaign,
  DbCharacter,
  DbCharacterSkill,
  DbCharacterTrait,
  DbCombatState,
  DbInventoryItem,
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
  readonly inventory: readonly DbInventoryItem[];
  readonly combat: DbCombatState | null;
  readonly campaign: DbCampaign | null;
}

export function buildCharacterDetail(input: SummaryInput) {
  const adapted: CharacterDetailInput = {
    character: input.character,
    traits: input.traits,
    skills: input.skills,
    inventory: input.inventory,
    combat: input.combat,
    campaign: input.campaign,
  };
  return buildCharacterDetailShared(adapted);
}

export const buildTraitOut = buildTraitOutShared;
export const buildCombatStateOut = buildCombatStateOutShared;
export const buildSkillOut = buildSkillOutShared;
export const buildInventoryItemOut = buildInventoryItemOutShared;
