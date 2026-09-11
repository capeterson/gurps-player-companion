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

import type { ManaLevel } from '../constants/magic.ts';
import type { SpellDifficulty } from '../constants/skills.ts';
import type { CharacterDetail, ResolvedEffectOut, TempEffect } from '../schemas/character.ts';
import type { CombatStateOut } from '../schemas/combat.ts';
import type { TraitEffect } from '../schemas/effects.ts';
import type { InventoryItemOut } from '../schemas/inventory.ts';
import type { LanguageOut } from '../schemas/language.ts';
import type { LibraryMechanics } from '../schemas/libraryMechanics.ts';
import type { SkillDefaults, SkillOut } from '../schemas/skill.ts';
import type { SpellOut } from '../schemas/spell.ts';
import type { TechniqueDifficulty, TechniqueOut } from '../schemas/technique.ts';
import type { TraitModifier, TraitOut } from '../schemas/trait.ts';
import {
  type CharacterAttrs,
  type CharacterLanguageInput,
  type CharacterSkillInput,
  type CharacterSpellInput,
  type CharacterTechniqueInput,
  type CharacterTraitInput,
  computeDerived,
  computePointBreakdown,
} from './characterCalc.ts';
import { type InventoryItemRow, computeEncumbrance, computeWeights } from './encumbrance.ts';
import { computeSkillLevel, resolveSkillLevels } from './skillCalc.ts';
import {
  computeSpellLevel,
  effectiveCastingCost,
  effectiveMaintenanceCost,
  mageryLevel,
  manaSkillModifier,
} from './spellCalc.ts';
import { computeTechniqueLevel, resolveDefaultSkillLevel } from './techniqueCalc.ts';
import { applyEffectsToAttrs, resolveEffects, skillBonusFor } from './traitEffects.ts';
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
  height: string | null;
  weight: string | null;
  age: number | null;
  birthdate: string | null;
  appearance: string | null;
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
  /** Optional: stale local Dexie rows and pre-migration server rows
   * may lack this column; adapters default it to `[]`. */
  tempEffects?: TempEffect[];
  dismissedWarnings: string[];
  /** Optional — defaults to []. Pre-Phase-2 rows may not have this field. */
  activeConditionGroups?: string[];
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
  /** Selected library variant name, or null for the base form. */
  variantName?: string | null;
  notes: string | null;
  modifiers: unknown[] | null;
  libraryTraitId: string | null;
  libraryMechanics?: LibraryMechanics | null;
  /**
   * Effect declarations from the matching library_trait row, joined by
   * libraryTraitId at fetch time.  Empty array if the trait has no
   * library reference or the library entry has no declared effects.
   */
  libraryEffects?: TraitEffect[];
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
  libraryMechanics?: LibraryMechanics | null;
  defaults?: SkillDefaults;
  /** Library skill effects, joined by librarySkillId.  Defaults to []. */
  libraryEffects?: TraitEffect[];
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
  enchantments: unknown | null;
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

export interface CharacterDetailInputLanguage {
  id: string;
  characterId: string;
  name: string;
  spokenFluency: 'none' | 'broken' | 'accented' | 'native' | 'n/a';
  writtenFluency: 'none' | 'broken' | 'accented' | 'native' | 'n/a';
  points: number;
  notes: string | null;
  libraryLanguageId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CharacterDetailInputTechnique {
  id: string;
  characterId: string;
  name: string;
  defaultSkillName: string;
  difficulty: TechniqueDifficulty;
  points: number;
  defaultModifier: number;
  maxLevel: number | null;
  notes: string | null;
  libraryTechniqueId: string | null;
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
  /** Optional: rows from before the mana column default to 'normal'. */
  manaLevel?: ManaLevel | null;
  /** Optional: rows from before the campaign tech-level column exist. */
  techLevel?: number | null;
}

export interface CharacterDetailInput {
  readonly character: CharacterDetailInputCharacter;
  readonly traits: readonly CharacterDetailInputTrait[];
  readonly skills: readonly CharacterDetailInputSkill[];
  readonly spells: readonly CharacterDetailInputSpell[];
  readonly languages: readonly CharacterDetailInputLanguage[];
  readonly techniques: readonly CharacterDetailInputTechnique[];
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
    tempEffects: c.tempEffects ?? [],
    // Trait-effect deltas; resolveEffects + applyEffectsToAttrs populate
    // these in buildCharacterDetail before computeDerived runs.
    dodgeMod: 0,
    parryMod: 0,
    blockMod: 0,
    drMod: 0,
    frightCheckMod: 0,
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
    variantName: trait.variantName ?? null,
    notes: trait.notes,
    modifiers: (trait.modifiers ?? []) as TraitModifier[],
    libraryTraitId: trait.libraryTraitId,
    libraryMechanics: trait.libraryMechanics ?? null,
    createdAt: toIso(trait.createdAt),
    updatedAt: toIso(trait.updatedAt),
  };
}

export function buildLanguageOut(language: CharacterDetailInputLanguage): LanguageOut {
  return {
    id: language.id,
    characterId: language.characterId,
    name: language.name,
    spokenFluency: language.spokenFluency,
    writtenFluency: language.writtenFluency,
    points: language.points,
    notes: language.notes,
    libraryLanguageId: language.libraryLanguageId,
    createdAt: toIso(language.createdAt),
    updatedAt: toIso(language.updatedAt),
  };
}

/**
 * `defaultSkillLevel` comes from resolving `defaultSkillName` against the
 * character's already-computed skill levels (see `resolveDefaultSkillLevel`);
 * pass null when the skill isn't on the sheet, which is what makes the
 * technique's own `level` null.
 */
export function buildTechniqueOut(
  technique: CharacterDetailInputTechnique,
  defaultSkillLevel: number | null,
): TechniqueOut {
  return {
    id: technique.id,
    characterId: technique.characterId,
    name: technique.name,
    defaultSkillName: technique.defaultSkillName,
    difficulty: technique.difficulty,
    points: technique.points,
    defaultModifier: technique.defaultModifier,
    maxLevel: technique.maxLevel,
    notes: technique.notes,
    libraryTechniqueId: technique.libraryTechniqueId,
    defaultSkillLevel,
    level: computeTechniqueLevel(
      technique.points,
      defaultSkillLevel,
      technique.difficulty,
      technique.maxLevel,
      technique.defaultModifier,
    ),
    createdAt: toIso(technique.createdAt),
    updatedAt: toIso(technique.updatedAt),
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
  skillBonus = 0,
  level = computeSkillLevel(
    skill.attribute,
    skill.difficulty,
    skill.points,
    derived,
    skill.defaults,
  ),
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
    libraryMechanics: skill.libraryMechanics ?? null,
    defaults: skill.defaults ?? null,
    level,
    // No usable declared default means there is no bonus target to apply against.
    effectiveLevel: level === null ? null : level + skillBonus,
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
    enchantments: (item.enchantments as InventoryItemOut['enchantments']) ?? [],
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
  mana: ManaLevel = 'normal',
): SpellOut {
  const difficulty = spell.difficulty ?? 'H';
  // Null when the spell has no points invested (no default in GURPS);
  // an unknown spell gets no skill discount either.
  const baseLevel = computeSpellLevel(spell.points, iq, magery, difficulty);
  const level = baseLevel == null ? null : baseLevel + manaSkillModifier(mana);
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
    effectiveCost:
      level == null ? spell.baseEnergyCost : effectiveCastingCost(spell.baseEnergyCost, level),
    effectiveMaintenanceCost:
      level == null
        ? spell.maintenanceCost
        : effectiveMaintenanceCost(spell.maintenanceCost, level),
    createdAt: toIso(spell.createdAt),
    updatedAt: toIso(spell.updatedAt),
  };
}

export function buildCharacterDetail(input: CharacterDetailInput): CharacterDetail {
  const { character, traits, skills, spells, languages, techniques, inventory, combat, campaign } =
    input;
  const baseAttrs = characterAttrsFromRow(character);

  // Resolve trait/skill effects FIRST.  Each character trait/skill carries
  // its libraryEffects (joined by libraryTraitId/librarySkillId at fetch
  // time).  Active conditional groups gate which effects are "on".
  const activeGroups = new Set(character.activeConditionGroups ?? []);
  const resolved = resolveEffects(
    traits.map((t) => ({
      id: t.id,
      name: t.name,
      level: t.level,
      libraryEffects: t.libraryEffects ?? [],
    })),
    skills.map((s) => ({
      id: s.id,
      name: s.name,
      libraryEffects: s.libraryEffects ?? [],
    })),
    activeGroups,
  );

  // Apply effects to attrs, THEN compute derived stats — so dodge / parry
  // / block / dr already include the trait contributions when the UI
  // reads them.
  const attrs = applyEffectsToAttrs(baseAttrs, resolved);
  const derived = computeDerived(attrs);

  const traitInputs: CharacterTraitInput[] = traits.map((t) => ({
    kind: t.kind,
    points: t.points,
  }));
  const skillInputs: CharacterSkillInput[] = skills.map((s) => ({ points: s.points }));
  // Spells are mechanically IQ/H skills, but a printed sheet totals them
  // in their own column and so do we -- they get a `spells` bucket rather
  // than being folded into `skills` (which is what they used to do).
  const spellInputs: CharacterSpellInput[] = spells.map((s) => ({ points: s.points }));
  // Use BASE attrs for point cost — trait-granted bonuses are paid for
  // by the trait itself, not double-billed against attribute spend.
  const languageInputs: CharacterLanguageInput[] = languages.map((l) => ({ points: l.points }));
  const techniqueInputs: CharacterTechniqueInput[] = techniques.map((t) => ({ points: t.points }));
  const points = computePointBreakdown(
    baseAttrs,
    traitInputs,
    skillInputs,
    languageInputs,
    techniqueInputs,
    spellInputs,
    campaign?.pointTarget ?? null,
  );

  const weights = computeWeights(inventory.map(inventoryRowFor));
  const encumbrance = computeEncumbrance(weights.playerWeightLbs, derived.basicLift);
  const inventoryOut = inventory.map((i) => buildInventoryItemOut(i, weights.perItem));
  const traitsOut = traits.map(buildTraitOut);
  const skillLevels = resolveSkillLevels(skills, derived);
  const skillsOut = skills.map((s) =>
    buildSkillOut(
      s,
      derived,
      skillBonusFor(s.name, resolved, s.specialization).total,
      skillLevels.get(s.id) ?? null,
    ),
  );
  const magery = mageryLevel(traits.map((t) => ({ name: t.name, level: t.level })));
  const manaLevel: ManaLevel = campaign?.manaLevel ?? 'normal';
  const techLevel: number | null = campaign?.techLevel ?? null;
  // A character in a campaign whose row we don't have yet (client-side,
  // before the campaign mirror lands in Dexie) gets the 'normal'
  // fallback above -- flag it so the UI can hold cast actions instead
  // of trusting a guess.  Campaignless characters are always 'known'.
  const manaLevelKnown = character.campaignId == null || campaign != null;
  const spellsOut = spells.map((s) => buildSpellOut(s, derived.effectiveIq, magery, manaLevel));
  const languagesOut = languages.map(buildLanguageOut);
  // Techniques default from a skill on the sheet, so they resolve against
  // the ALREADY-COMPUTED skill rows (effectiveLevel, i.e. after Talents
  // and other trait effects) rather than re-deriving levels here.
  const techniqueSkillCandidates = skillsOut.map((s) => ({
    name: s.name,
    specialization: s.specialization,
    level: s.effectiveLevel,
  }));
  const techniquesOut = techniques.map((t) =>
    buildTechniqueOut(t, resolveDefaultSkillLevel(t.defaultSkillName, techniqueSkillCandidates)),
  );
  const combatOut = combat ? buildCombatStateOut(combat) : null;

  // Strip the unused `sourceCharacterRecordId` field name — the schema
  // calls it `sourceId` for brevity.  resolveEffects already emits sourceId.
  const effectsOut: ResolvedEffectOut[] = resolved.map((e) => ({
    sourceKind: e.sourceKind,
    sourceName: e.sourceName,
    sourceId: e.sourceId,
    target: e.target,
    value: e.value,
    skillName: e.skillName,
    skillSpecialty: e.skillSpecialty,
    hitLocation: e.hitLocation,
    conditionGroup: e.conditionGroup,
    conditionLabel: e.conditionLabel,
    active: e.active,
  }));

  const caps: CampaignCaps = {
    pointTarget: campaign?.pointTarget ?? null,
    disadvantageCap: campaign?.disadvantageCap ?? null,
    quirkCap: campaign?.quirkCap ?? null,
  };
  const dismissed = new Set(character.dismissedWarnings);
  const warnings = evaluateWarnings(
    {
      attrs: {
        st: character.st,
        dx: character.dx,
        iq: character.iq,
        ht: character.ht,
        hpMod: character.hpMod,
        fpMod: character.fpMod,
      },
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
    height: character.height,
    weight: character.weight,
    age: character.age,
    birthdate: character.birthdate,
    appearance: character.appearance,
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
    tempEffects: character.tempEffects ?? [],
    dismissedWarnings: character.dismissedWarnings,
    activeConditionGroups: character.activeConditionGroups ?? [],
    createdAt: toIso(character.createdAt),
    updatedAt: toIso(character.updatedAt),
    revision: Number(character.revision),
    derived,
    points,
    encumbrance,
    warnings,
    manaLevel,
    manaLevelKnown,
    techLevel,
    traits: traitsOut,
    skills: skillsOut,
    spells: spellsOut,
    languages: languagesOut,
    techniques: techniquesOut,
    inventory: inventoryOut,
    combat: combatOut,
    effects: effectsOut,
  };
}
