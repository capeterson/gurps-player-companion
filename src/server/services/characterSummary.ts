/**
 * Build the full CharacterDetail response shape from a character row,
 * its traits, skills, inventory, and the parent campaign's caps.
 *
 * Reuses the pure shared/ domain logic — server and client compute
 * derived stats / points / warnings from the same source.
 */

import {
  type CharacterAttrs,
  type CharacterSkillInput,
  type CharacterTraitInput,
  computeDerived,
  computePointBreakdown,
} from '../../shared/domain/characterCalc.ts';
import {
  type InventoryItemRow,
  computeEncumbrance,
  computeWeights,
} from '../../shared/domain/encumbrance.ts';
import { computeSkillLevel } from '../../shared/domain/skillCalc.ts';
import { type CampaignCaps, evaluateWarnings } from '../../shared/domain/warnings.ts';
import type { CharacterDetail } from '../../shared/schemas/character.ts';
import type { CombatStateOut } from '../../shared/schemas/combat.ts';
import type { InventoryItemOut } from '../../shared/schemas/inventory.ts';
import type { SkillOut } from '../../shared/schemas/skill.ts';
import type { TraitModifier, TraitOut } from '../../shared/schemas/trait.ts';
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

function toIso(d: Date): string {
  return d.toISOString();
}

function inventoryRowFor(i: DbInventoryItem): InventoryItemRow {
  return {
    id: i.id,
    parentId: i.parentId,
    weightLbs: Number(i.weightLbs),
    quantity: i.quantity,
    worn: i.worn,
    isContainer: i.isContainer,
    hideawayCapacityLbs: Number(i.hideawayCapacityLbs),
    weightReductionPercent: i.weightReductionPercent,
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

export function buildCharacterDetail(input: SummaryInput): CharacterDetail {
  const { character, traits, skills, inventory, combat, campaign } = input;
  const attrs = characterAttrsFromRow(character);
  const derived = computeDerived(attrs);

  const traitInputs: CharacterTraitInput[] = traits.map((t) => ({
    kind: t.kind,
    points: t.points,
  }));
  const skillInputs: CharacterSkillInput[] = skills.map((s) => ({ points: s.points }));
  const points = computePointBreakdown(attrs, traitInputs, skillInputs);

  const weights = computeWeights(inventory.map(inventoryRowFor));
  const encumbrance = computeEncumbrance(weights.playerWeightLbs, derived.basicLift);
  const inventoryOut = inventory.map((i) => buildInventoryItemOut(i, weights.perItem));
  const traitsOut = traits.map(buildTraitOut);
  const skillsOut = skills.map((s) => buildSkillOut(s, derived));
  const combatOut = combat ? buildCombatStateOut(combat) : null;

  const caps: CampaignCaps = {
    pointTarget: campaign?.pointTarget ?? null,
    disadvantageCap: campaign?.disadvantageCap ?? null,
    quirkCap: campaign?.quirkCap ?? null,
  };
  const dismissed = new Set(character.dismissedWarnings);
  const warnings = evaluateWarnings(
    {
      attrs: { st: character.st, dx: character.dx, iq: character.iq, ht: character.ht },
      points,
      encumbrance,
      campaign: caps,
    },
    dismissed,
  );

  return {
    id: character.id,
    ownerId: character.ownerId,
    campaignId: character.campaignId,
    name: character.name,
    playerName: character.playerName,
    height: character.height,
    weight: character.weight,
    age: character.age,
    appearance: character.appearance,
    techLevel: character.techLevel,
    st: character.st,
    dx: character.dx,
    iq: character.iq,
    ht: character.ht,
    hpMod: character.hpMod,
    willMod: character.willMod,
    perMod: character.perMod,
    fpMod: character.fpMod,
    speedQuarterMod: character.speedQuarterMod,
    moveMod: character.moveMod,
    tempSt: character.tempSt,
    tempDx: character.tempDx,
    tempIq: character.tempIq,
    tempHt: character.tempHt,
    tempHpMod: character.tempHpMod,
    tempWillMod: character.tempWillMod,
    tempPerMod: character.tempPerMod,
    tempFpMod: character.tempFpMod,
    tempSpeedQuarterMod: character.tempSpeedQuarterMod,
    tempMoveMod: character.tempMoveMod,
    dismissedWarnings: character.dismissedWarnings,
    createdAt: toIso(character.createdAt),
    updatedAt: toIso(character.updatedAt),
    revision: Number(character.revision),
    derived,
    points,
    encumbrance,
    warnings,
    traits: traitsOut,
    skills: skillsOut,
    inventory: inventoryOut,
    combat: combatOut,
  };
}

export function buildTraitOut(trait: DbCharacterTrait): TraitOut {
  return {
    id: trait.id,
    characterId: trait.characterId,
    kind: trait.kind,
    name: trait.name,
    points: trait.points,
    level: trait.level,
    notes: trait.notes,
    modifiers: (trait.modifiers ?? []) as TraitModifier[],
    libraryTraitId: trait.libraryTraitId,
    createdAt: toIso(trait.createdAt),
    updatedAt: toIso(trait.updatedAt),
  };
}

export function buildCombatStateOut(state: DbCombatState): CombatStateOut {
  return {
    id: state.id,
    characterId: state.characterId,
    currentHp: state.currentHp,
    currentFp: state.currentFp,
    conditions: state.conditions,
    maneuver: state.maneuver,
    posture: state.posture,
    createdAt: toIso(state.createdAt),
    updatedAt: toIso(state.updatedAt),
  };
}

export function buildSkillOut(
  skill: DbCharacterSkill,
  derived: ReturnType<typeof computeDerived>,
): SkillOut {
  return {
    id: skill.id,
    characterId: skill.characterId,
    name: skill.name,
    attribute: skill.attribute,
    difficulty: skill.difficulty,
    points: skill.points,
    techLevel: skill.techLevel,
    specialization: skill.specialization,
    notes: skill.notes,
    librarySkillId: skill.librarySkillId,
    level: computeSkillLevel(skill.attribute, skill.difficulty, skill.points, derived),
    createdAt: toIso(skill.createdAt),
    updatedAt: toIso(skill.updatedAt),
  };
}

export function buildInventoryItemOut(
  item: DbInventoryItem,
  perItemEffective: Map<string, number>,
): InventoryItemOut {
  return {
    id: item.id,
    characterId: item.characterId,
    name: item.name,
    quantity: item.quantity,
    weightLbs: Number(item.weightLbs),
    cost: Number(item.cost),
    notes: item.notes,
    parentId: item.parentId,
    externalLocation: item.externalLocation,
    worn: item.worn,
    equipped: item.equipped,
    isContainer: item.isContainer,
    hideawayCapacityLbs: Number(item.hideawayCapacityLbs),
    weightReductionPercent: item.weightReductionPercent,
    isArmor: item.isArmor,
    armor: (item.armor as InventoryItemOut['armor']) ?? null,
    weaponData: (item.weaponData as InventoryItemOut['weaponData']) ?? null,
    libraryItemId: item.libraryItemId,
    effectiveWeightLbs: perItemEffective.get(item.id) ?? Number(item.weightLbs) * item.quantity,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}
