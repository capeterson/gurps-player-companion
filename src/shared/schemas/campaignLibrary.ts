import { z } from 'zod';
import { isoTimestamp, uuid } from './common.ts';
import { armorData, weaponData } from './inventory.ts';
import { situationalModifier, skillAttributeEnum, skillDifficultyEnum } from './skill.ts';
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
    items: z.array(libraryItemCreate).default([]),
  }),
});

export type LibraryTraitOut = z.infer<typeof libraryTraitOut>;
export type LibraryTraitCreate = z.infer<typeof libraryTraitCreate>;
export type LibraryTraitUpdate = z.infer<typeof libraryTraitUpdate>;
export type LibrarySkillOut = z.infer<typeof librarySkillOut>;
export type LibrarySkillCreate = z.infer<typeof librarySkillCreate>;
export type LibrarySkillUpdate = z.infer<typeof librarySkillUpdate>;
export type LibraryItemOut = z.infer<typeof libraryItemOut>;
export type LibraryItemCreate = z.infer<typeof libraryItemCreate>;
export type LibraryItemUpdate = z.infer<typeof libraryItemUpdate>;
export type ImportMode = z.infer<typeof importMode>;
export type ImportResult = z.infer<typeof importResult>;
export type LibraryYamlDoc = z.infer<typeof libraryYamlDoc>;
