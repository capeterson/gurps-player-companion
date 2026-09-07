import { z } from 'zod';
import { MANA_LEVELS } from '../constants/magic.ts';
import { timestamps, uuid } from './common.ts';
import { traitEffect } from './effects.ts';
import {
  armorData,
  enchantmentRef,
  magicItemData,
  powerstoneData,
  weaponData,
} from './inventory.ts';
import { situationalModifier, skillAttributeEnum, skillDifficultyEnum } from './skill.ts';
import { spellDifficulty } from './spell.ts';
import { techniqueDifficulty } from './technique.ts';
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

/**
 * Library languages hold the book-level definition (name, blurb, source)
 * that a character copies when adding the language to their sheet.
 * Fluency and points are per-character and live on `character_languages`.
 */
export const libraryLanguageOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  /** Sign languages have no written form; the UI defaults their written
   * fluency to `'n/a'` when the language is copied onto a sheet. */
  isSignLanguage: z.boolean(),
  ...timestamps,
});

export const libraryLanguageCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  isSignLanguage: z.boolean().default(false),
});

export const libraryLanguageUpdate = libraryLanguageCreate.partial();

/**
 * Library technique: the book definition a character copies onto their
 * sheet.  Per-character state (points invested) lives on
 * `character_techniques`.
 */
export const libraryTechniqueOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  defaultSkillName: z.string().min(1).max(160),
  difficulty: techniqueDifficulty,
  /** Default cap on the bonus above the default skill; null = uncapped. */
  maxLevel: z.number().int().min(0).max(20).nullable(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  /** Capped at the character-technique note limit -- copied verbatim on learn. */
  prereq: z.string().max(2000).nullable(),
  ...timestamps,
});

export const libraryTechniqueCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  defaultSkillName: z.string().min(1).max(160).trim(),
  difficulty: techniqueDifficulty.default('A'),
  maxLevel: z.number().int().min(0).max(20).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  prereq: z.string().max(2000).nullable().optional(),
});

export const libraryTechniqueUpdate = libraryTechniqueCreate.partial();

/**
 * One technique named by a style.  Denormalized (name + default skill +
 * difficulty rather than a `campaign_library_techniques` id) so a style
 * stays valid through a YAML round trip into a campaign that doesn't
 * have the matching technique rows yet -- adopting the style creates the
 * character techniques directly from these entries.
 *
 * Validates `campaign_library_styles.techniques` (jsonb) -- see
 * docs/specs/json-fields.md.
 */
export const styleTechniqueRef = z.object({
  name: z.string().min(1).max(160).trim(),
  defaultSkillName: z.string().min(1).max(160).trim(),
  difficulty: techniqueDifficulty.default('A'),
  maxLevel: z.number().int().min(0).max(20).nullable().optional(),
});
export type StyleTechniqueRef = z.infer<typeof styleTechniqueRef>;

/** Validates `campaign_library_styles.perks` / `.skills` (jsonb). */
export const styleNameList = z.array(z.string().min(1).max(160).trim()).max(100).default([]);

/**
 * A martial-arts style (Martial Arts p. 139): a named package of
 * techniques, perks, and skills.  Campaign-library-only -- characters
 * "adopt" a style by adding its constituent pieces individually, so
 * there is no per-character style join table.
 */
export const libraryStyleOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  techniques: z.array(styleTechniqueRef).max(100).default([]),
  perks: styleNameList,
  skills: styleNameList,
  ...timestamps,
});

export const libraryStyleCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  techniques: z.array(styleTechniqueRef).max(100).default([]),
  perks: styleNameList,
  skills: styleNameList,
});

export const libraryStyleUpdate = libraryStyleCreate.partial();

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
  /** Non-mechanical enchantment list carried onto inventory copies. */
  enchantments: z.array(enchantmentRef).max(50).default([]),
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
  enchantments: z.array(enchantmentRef).max(50).default([]),
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
  languages: importSectionResult,
  techniques: importSectionResult,
  styles: importSectionResult,
  /** Whether the opt-in `applyCampaignSettings` flag actually updated the
   * campaigns row (false when the flag was off or the doc had no `campaign`
   * block). */
  campaignSettingsApplied: z.boolean(),
});

// ---------- YAML doc shape (versioned) ----------

/**
 * v1 docs (pre-effects), v2 docs (effects on traits/skills), v3 docs
 * (container/powerstone/magic-item item fields + campaign.manaLevel), v4
 * docs (languages + techniques + styles sections), and v5 docs
 * (enchantments on items) all parse.  Schema unions on a literal version
 * field so older library files keep round-tripping without mutation.
 * Older docs that omit the newer fields get their defaults (empty
 * array / false / null) via the library*Create schemas.
 */
export const libraryYamlVersion = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

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
      /** Campaign-wide tech level (Basic Set p. 513). */
      techLevel: z.number().int().min(0).max(12).nullable().optional(),
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
    /** Optional for the same reason as `spells`: pre-v4 exports have no
     * languages section, and a replace-mode import of one of those files
     * must not wipe the campaign's language library. */
    languages: z.array(libraryLanguageCreate).optional(),
    /** Optional for the same reason as `languages`. */
    techniques: z.array(libraryTechniqueCreate).optional(),
    /** Optional for the same reason as `languages`. */
    styles: z.array(libraryStyleCreate).optional(),
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
export type LibraryTechniqueOut = z.infer<typeof libraryTechniqueOut>;
export type LibraryTechniqueCreate = z.infer<typeof libraryTechniqueCreate>;
export type LibraryTechniqueUpdate = z.infer<typeof libraryTechniqueUpdate>;
export type LibraryStyleOut = z.infer<typeof libraryStyleOut>;
export type LibraryStyleCreate = z.infer<typeof libraryStyleCreate>;
export type LibraryStyleUpdate = z.infer<typeof libraryStyleUpdate>;
export type LibraryLanguageOut = z.infer<typeof libraryLanguageOut>;
export type LibraryLanguageCreate = z.infer<typeof libraryLanguageCreate>;
export type LibraryLanguageUpdate = z.infer<typeof libraryLanguageUpdate>;
export type LibraryItemOut = z.infer<typeof libraryItemOut>;
export type LibraryItemCreate = z.infer<typeof libraryItemCreate>;
export type LibraryItemUpdate = z.infer<typeof libraryItemUpdate>;
export type ImportMode = z.infer<typeof importMode>;
export type ImportResult = z.infer<typeof importResult>;
export type LibraryYamlDoc = z.infer<typeof libraryYamlDoc>;
