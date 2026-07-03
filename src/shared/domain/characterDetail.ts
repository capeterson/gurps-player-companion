/**
 * Build the full CharacterDetail response shape from raw row data.
 *
 * Lives in `shared/` (not `server/`) because the local-first client
 * also has to derive CharacterDetail from Dexie rows -- per
 * useLiveQuery the UI reads raw rows + computes derived stats /
 * points / warnings on the fly.  Keeping a single builder means the
 * server's `/characters/{id}` HTTP response and the client's
 * `useCharacterDetail` hook can never disagree about derived values.
 *
 * The builder accepts ISO strings OR Date instances for the
 * `createdAt` / `updatedAt` fields so it works in both Bun (Date) and
 * the browser (Dexie returns ISO strings).
 */

import type { SpellDifficulty } from '../constants/skills.ts';
import type { CharacterDetail } from '../schemas/character.ts';
import type { CombatStateOut } from '../schemas/combat.ts';
import type { InventoryItemOut } from '../schemas/inventory.ts';
import type { SkillOut } from '../schemas/skill.ts';
import type { SpellOut } from '../schemas/spell.ts';
import type { TraitModifier, TraitOut } from '../schemas/trait.ts';
import {
  type CharacterAttrs,
  type CharacterSkillInput,
  type CharacterTraitInput,
  computeDerived,
  computePointBreakdown,
} from './characterCalc.ts';
import { type InventoryItemRow, computeEncumbrance, computeWeights } from './encumbrance.ts';
import { computeSkillLevel } from './skillCalc.ts';
import {
  computeSpellLevel,
  effectiveCastingCost,
  effectiveMaintenanceCost,
  mageryLevel,
} from './spellCalc.ts';
import { type CampaignCaps, evaluateWarnings } from './warnings.ts';

/**
 * Minimal row shape the builder needs.  Both server (Drizzle) rows
 * and client (Dexie) rows satisfy this -- the difference is that
 * server rows have `Date` for timestamps and the bigserial as a
 * `number | bigint` for revision; client rows already store ISO
 * strings + plain numbers.  The builder normalizes both.
 */
export interface CharacterDetailInputCharacter {
  id: string;
  ownerId: string;
  campaignId: string | null;
  name: string;
  playerName: string | null;
  height: string | null;
  weight: string | null;
  age: number | null;
  appearance: string | null;
  techLevel: number | null;
  st: number;
  dx: number;
  iq: number;
  ht: number;
  hpMod: number;
  willMod: number;
  perMod: number;
  fpMod: number;
  speedQuarterMod: number;
  moveMod: number;
  tempSt: number;
  tempDx: number;
  tempIq: number;
  tempHt: number;
  tempHpMod: number;
  tempWillMod: number;
  tempPerMod: number;
  tempFpMod: number;
  tempSpeedQuarterMod: number;
  tempMoveMod: number;
  dismissedWarnings: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
  revision: number | bigint;
}

export interface CharacterDetailInputTrait {
  id: string;
  characterId: string;
  kind: 'advantage' | 'disadvantage' | 'perk' | 'quirk' | 'language' | 'cultural_familiarity';
  name: string;
  points: number;
  level: number | null;
  notes: string | null;
  modifiers: unknown[] | null;
  libraryTraitId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputSkill {
  id: string;
  characterId: string;
  name: string;
  attribute: 'ST' | 'DX' | 'IQ' | 'HT' | 'Will' | 'Per' | 'Other';
  difficulty: 'E' | 'A' | 'H' | 'VH';
  points: number;
  techLevel: number | null;
  specialization: string | null;
  notes: string | null;
  librarySkillId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputInventory {
  id: string;
  characterId: string;
  name: string;
  quantity: number;
  weightLbs: number | string;
  cost: number | string;
  notes: string | null;
  parentId: string | null;
  externalLocation: string | null;
  worn: boolean;
  equipped: boolean;
  isContainer: boolean;
  hideawayCapacityLbs: number | string;
  weightReductionPercent: number;
  isArmor: boolean;
  armor: unknown | null;
  weaponData: unknown | null;
  powerstoneData: unknown | null;
  magicItemData: unknown | null;
  libraryItemId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputSpell {
  id: string;
  characterId: string;
  name: string;
  college: string | null;
  /** Optional: local rows synced before the column existed lack it;
   * `buildSpellOut` defaults missing values to 'H'. */
  difficulty?: SpellDifficulty;
  points: number;
  baseEnergyCost: number;
  maintenanceCost: number | null;
  castingTime: string | null;
  duration: string | null;
  prerequisites: string | null;
  notes: string | null;
  librarySpellId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputCombat {
  id: string;
  characterId: string;
  currentHp: number;
  currentFp: number;
  conditions: string[];
  maneuver: string | null;
  posture: 'standing' | 'prone' | 'kneeling' | 'crawling' | 'sitting' | 'crouching' | 'lying';
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputCampaign {
  pointTarget: number | null;
  disadvantageCap: number | null;
  quirkCap: number | null;
}

export interface CharacterDetailInput {
  readonly character: CharacterDetailInputCharacter;
  readonly traits: readonly CharacterDetailInputTrait[];
  readonly skills: readonly CharacterDetailInputSkill[];
  readonly spells: readonly CharacterDetailInputSpell[];
  readonly inventory: readonly CharacterDetailInputInventory[];
  readonly combat: CharacterDetailInputCombat | null;
  readonly campaign: CharacterDetailInputCampaign | null;
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d;
}

function characterAttrsFromRow(c: CharacterDetailInputCharacter): CharacterAttrs {
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

function inventoryRowFor(i: CharacterDetailInputInventory): InventoryItemRow {
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

export function buildTraitOut(trait: CharacterDetailInputTrait): TraitOut {
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

export function buildCombatStateOut(state: CharacterDetailInputCombat): CombatStateOut {
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
  skill: CharacterDetailInputSkill,
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
  item: CharacterDetailInputInventory,
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
    powerstoneData: (item.powerstoneData as InventoryItemOut['powerstoneData']) ?? null,
    magicItemData: (item.magicItemData as InventoryItemOut['magicItemData']) ?? null,
    libraryItemId: item.libraryItemId,
    effectiveWeightLbs: perItemEffective.get(item.id) ?? Number(item.weightLbs) * item.quantity,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}

export function buildSpellOut(
  spell: CharacterDetailInputSpell,
  iq: number,
  magery: number,
): SpellOut {
  const difficulty = spell.difficulty ?? 'H';
  const level = computeSpellLevel(spell.points, iq, magery, difficulty);
  return {
    id: spell.id,
    characterId: spell.characterId,
    name: spell.name,
    college: spell.college,
    difficulty,
    points: spell.points,
    baseEnergyCost: spell.baseEnergyCost,
    maintenanceCost: spell.maintenanceCost,
    castingTime: spell.castingTime,
    duration: spell.duration,
    prerequisites: spell.prerequisites,
    notes: spell.notes,
    librarySpellId: spell.librarySpellId,
    level,
    effectiveCost: effectiveCastingCost(spell.baseEnergyCost, level),
    effectiveMaintenanceCost: effectiveMaintenanceCost(spell.maintenanceCost, level),
    createdAt: toIso(spell.createdAt),
    updatedAt: toIso(spell.updatedAt),
  };
}

export function buildCharacterDetail(input: CharacterDetailInput): CharacterDetail {
  const { character, traits, skills, spells, inventory, combat, campaign } = input;
  const attrs = characterAttrsFromRow(character);
  const derived = computeDerived(attrs);

  const traitInputs: CharacterTraitInput[] = traits.map((t) => ({
    kind: t.kind,
    points: t.points,
  }));
  // Spells are mechanically IQ/H skills, so their points roll into the
  // skill point bucket alongside regular skills.  This keeps the point
  // ledger consistent with how a paper sheet adds them up.
  const skillInputs: CharacterSkillInput[] = [
    ...skills.map((s) => ({ points: s.points })),
    ...spells.map((s) => ({ points: s.points })),
  ];
  const points = computePointBreakdown(attrs, traitInputs, skillInputs);

  const weights = computeWeights(inventory.map(inventoryRowFor));
  const encumbrance = computeEncumbrance(weights.playerWeightLbs, derived.basicLift);
  const inventoryOut = inventory.map((i) => buildInventoryItemOut(i, weights.perItem));
  const traitsOut = traits.map(buildTraitOut);
  const skillsOut = skills.map((s) => buildSkillOut(s, derived));
  const magery = mageryLevel(traits.map((t) => ({ name: t.name, level: t.level })));
  const spellsOut = spells.map((s) => buildSpellOut(s, derived.effectiveIq, magery));
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
    view: 'full',
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
    spells: spellsOut,
    inventory: inventoryOut,
    combat: combatOut,
  };
}
