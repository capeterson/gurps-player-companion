import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';
import { armorData, weaponData } from './inventory.ts';
import { situationalModifier, skillAttributeEnum, skillDifficultyEnum } from './skill.ts';
import { spellDifficulty } from './spell.ts';
import { traitKindEnum, traitModifier } from './trait.ts';

const tagList = z.array(z.string().min(1).max(40)).default([]);

// ---------- Library entities (server-side persisted shape) ----------

export const libraryTraitOut = z.object({
  id: uuid,
  campaignId: uuid,
  name: z.string().min(1).max(160),
  kind: traitKindEnum,
  basePoints: z.number().int(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  availableModifiers: z.array(traitModifier).default([]),
  tags: tagList,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const libraryTraitCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  kind: traitKindEnum,
  basePoints: z.number().int().min(-1000).max(1000).default(0),
  description: z.string().max(20_000).nullable().optional(),
  source: z.string().max(40).trim().nullable().optional(),
  availableModifiers: z.array(traitModifier).default([]),
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
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
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
  prerequisites: z.string().max(20_000).nullable(),
  description: z.string().max(20_000).nullable(),
  source: z.string().max(40).nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

export const librarySpellCreate = z.object({
  name: z.string().min(1).max(160).trim(),
  college: z.string().max(80).trim().nullable().optional(),
  difficulty: spellDifficulty.default('H'),
  baseEnergyCost: z.number().int().min(0).max(99).default(1),
  maintenanceCost: z.number().int().min(0).max(99).nullable().optional(),
  castingTime: z.string().max(40).trim().nullable().optional(),
  duration: z.string().max(40).trim().nullable().optional(),
  prerequisites: z.string().max(20_000).nullable().optional(),
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
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
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
});

// ---------- YAML doc shape (versioned) ----------

export const libraryYamlVersion = z.literal(1);

export const libraryYamlDoc = z.object({
  version: libraryYamlVersion,
  campaign: z
    .object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(20_000).nullable().optional(),
      pointTarget: z.number().int().nullable().optional(),
      disadvantageCap: z.number().int().nullable().optional(),
      quirkCap: z.number().int().nullable().optional(),
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
