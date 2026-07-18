import { z } from 'zod';
import { MANA_LEVELS } from '../constants/magic.ts';
import { timestamps, uuid } from './common.ts';
import { traitEffect } from './effects.ts';
import { armorData, magicItemData, powerstoneData, weaponData } from './inventory.ts';
import { situationalModifier, skillAttributeEnum, skillDifficultyEnum } from './skill.ts';
import { spellDifficulty } from './spell.ts';
import { traitKindEnum, traitModifier, traitVariant } from './trait.ts';

const tagList = z.array(z.string().min(1).max(40)).default([]);

// ---------- Library entities (server-side persisted shape) ----------

export const libraryTraitOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  kind: traitKindEnum,
  basePoints: z.number().int(),
  /**
   * Cost per level above level 0.  When non-null the trait is "leveled"
   * and `points = basePoints + level * pointsPerLevel` (Magery: base 5 +
   * 10/level; Acute Vision: base 0 + 2/level; Damage Resistance: base 0
   * + 5/level).  Null for fixed-cost traits like Combat Reflexes.
   */
  pointsPerLevel: z.number().int().min(-1000).max(1000).nullable(),
  /** Optional level cap; UI clamps the picker. */
  maxLevel: z.number().int().min(1).max(99).nullable(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  availableModifiers: z.array(traitModifier).default([]),
  /**
   * Named alternative forms of the trait.  Character picks at most one
   * variant; the variant's cost adjustment applies after level scaling
   * and before per-instance modifiers.
   */
  variants: z.array(traitVariant).default([]),
  effects: z.array(traitEffect).default([]),
  tags: tagList,
  ...timestamps,
});

export const libraryTraitCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  kind: traitKindEnum,
  basePoints: z.number().int().min(-1000).max(1000).default(0),
  pointsPerLevel: z.number().int().min(-1000).max(1000).nullable().optional(),
  maxLevel: z.number().int().min(1).max(99).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  availableModifiers: z.array(traitModifier).default([]),
  variants: z.array(traitVariant).default([]),
  effects: z.array(traitEffect).default([]),
  tags: tagList,
});

export const libraryTraitUpdate = libraryTraitCreate.partial();

export const librarySkillOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  attribute: skillAttributeEnum,
  difficulty: skillDifficultyEnum,
  techLevel: z.number().int().min(0).max(12).nullable(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  defaultSpecialization: z.string().max(160).nullable(),
  prerequisites: z.string().max(20_000).nullable(),
  situationalModifiers: z.array(situationalModifier).default([]),
  effects: z.array(traitEffect).default([]),
  ...timestamps,
});

export const librarySkillCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  attribute: skillAttributeEnum,
  difficulty: skillDifficultyEnum,
  techLevel: z.number().int().min(0).max(12).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).nullable().optional(),
  defaultSpecialization: z.string().max(160).nullable().optional(),
  prerequisites: z.string().max(20_000).nullable().optional(),
  situationalModifiers: z.array(situationalModifier).default([]),
  effects: z.array(traitEffect).default([]),
});

export const librarySkillUpdate = librarySkillCreate.partial();

/**
 * Library spells mirror the per-character spell shape minus the
 * per-character bits (points, character id): the library records the
 * book data a player copies when learning the spell.
 */
export const librarySpellOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  college: z.string().max(80).nullable(),
  difficulty: spellDifficulty,
  baseEnergyCost: z.number().int().min(0).max(99),
  maintenanceCost: z.number().int().min(0).max(99).nullable(),
  castingTime: z.string().max(40).nullable(),
  duration: z.string().max(40).nullable(),
  /** Capped at the character-spell limit (spellCreate.prerequisites,
   * 2000) because learning a library spell copies this value verbatim
   * into the character row -- a longer value would import fine and
   * then be rejected every time someone learns the spell. */
  prerequisites: z.string().max(2000).nullable(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  ...timestamps,
});

export const librarySpellCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  college: z.string().max(80).trim().nullable().optional(),
  difficulty: spellDifficulty.default('H'),
  baseEnergyCost: z.number().int().min(0).max(99).default(1),
  maintenanceCost: z.number().int().min(0).max(99).nullable().optional(),
  castingTime: z.string().max(40).trim().nullable().optional(),
  duration: z.string().max(40).trim().nullable().optional(),
  /** Must fit spellCreate.prerequisites (2000) -- see librarySpellOut. */
  prerequisites: z.string().max(2000).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
});

export const librarySpellUpdate = librarySpellCreate.partial();

export const libraryItemOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  category: z.string().max(40),
  defaultQuantity: z.number().int().min(0).max(1_000_000),
  weightLbs: z.number().min(0).max(1_000_000),
  cost: z.number().min(0).max(100_000_000_000),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  isArmor: z.boolean(),
  armor: armorData.nullable(),
  weaponData: weaponData.nullable(),
  isContainer: z.boolean(),
  hideawayCapacityLbs: z.number().min(0).max(1_000_000),
  weightReductionPercent: z.number().int().min(0).max(100),
  powerstoneData: powerstoneData.nullable(),
  magicItemData: magicItemData.nullable(),
  ...timestamps,
});

export const libraryItemCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  category: z.string().max(40).trim().default('general'),
  defaultQuantity: z.number().int().min(0).max(1_000_000).default(1),
  weightLbs: z.number().min(0).max(1_000_000).default(0),
  cost: z.number().min(0).max(100_000_000_000).default(0),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  isArmor: z.boolean().default(false),
  armor: armorData.nullable().optional(),
  weaponData: weaponData.nullable().optional(),
  isContainer: z.boolean().default(false),
  hideawayCapacityLbs: z.number().min(0).max(1_000_000).default(0),
  weightReductionPercent: z.number().int().min(0).max(100).default(0),
  powerstoneData: powerstoneData.nullable().optional(),
  magicItemData: magicItemData.nullable().optional(),
});

export const libraryItemUpdate = libraryItemCreate.partial();

// ---------- Import / Export ----------

export const importMode = z.enum(['merge', 'replace']);

export const importSectionResult = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});

export const importResult = z.object({
  mode: importMode,
  traits: importSectionResult,
  skills: importSectionResult,
  spells: importSectionResult,
  items: importSectionResult,
  /** Whether the opt-in `applyCampaignSettings` flag actually updated the
   * campaigns row (false when the flag was off or the doc had no `campaign`
   * block). */
  campaignSettingsApplied: z.boolean(),
});

// ---------- YAML doc shape (versioned) ----------

/**
 * v1 docs (pre-effects), v2 docs (effects on traits/skills), and v3 docs
 * (container/powerstone/magic-item item fields + campaign.manaLevel) all
 * parse.  Schema unions on a literal version field so older library files
 * keep round-tripping without mutation.  v1/v2 docs that omit the newer
 * fields get their defaults (empty array / false / null) via the
 * library*Create schemas.
 */
export const libraryYamlVersion = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const libraryYamlDoc = z.object({
  version: libraryYamlVersion,
  campaign: z
    .object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(20_000).nullable().optional(),
      pointTarget: z.number().int().nullable().optional(),
      disadvantageCap: z.number().int().nullable().optional(),
      quirkCap: z.number().int().nullable().optional(),
      /** Ambient mana level (Basic Set p. 235); reuses the campaign schema's enum. */
      manaLevel: z.enum(MANA_LEVELS).optional(),
    })
    .optional(),
  library: z.object({
    traits: z.array(libraryTraitCreate).default([]),
    skills: z.array(librarySkillCreate).default([]),
    /** Optional (no default): pre-spell-library exports lack this
     * section, and a replace-mode import must be able to tell "no
     * spells section" (leave existing spells alone) apart from an
     * explicit empty list (delete them all). */
    spells: z.array(librarySpellCreate).optional(),
    items: z.array(libraryItemCreate).default([]),
  }),
});

export type LibraryTraitOut = z.infer<typeof libraryTraitOut>;
export type LibraryTraitCreate = z.infer<typeof libraryTraitCreate>;
export type LibraryTraitUpdate = z.infer<typeof libraryTraitUpdate>;
export type LibrarySkillOut = z.infer<typeof librarySkillOut>;
export type LibrarySkillCreate = z.infer<typeof librarySkillCreate>;
export type LibrarySkillUpdate = z.infer<typeof librarySkillUpdate>;
export type LibrarySpellOut = z.infer<typeof librarySpellOut>;
export type LibrarySpellCreate = z.infer<typeof librarySpellCreate>;
export type LibrarySpellUpdate = z.infer<typeof librarySpellUpdate>;
export type LibraryItemOut = z.infer<typeof libraryItemOut>;
export type LibraryItemCreate = z.infer<typeof libraryItemCreate>;
export type LibraryItemUpdate = z.infer<typeof libraryItemUpdate>;
export type ImportMode = z.infer<typeof importMode>;
export type ImportResult = z.infer<typeof importResult>;
export type LibraryYamlDoc = z.infer<typeof libraryYamlDoc>;
