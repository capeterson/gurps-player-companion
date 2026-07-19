/**
 * Per-entity configuration for the four campaign-library kinds (traits,
 * skills, spells, items).  `campaignLibraryCrud.ts` consumes these configs
 * to register the POST/PATCH/DELETE routes and drive the YAML
 * upsert-by-key import loop generically; `campaignLibrary.ts` uses them
 * for the GET list, YAML export, and import handlers.
 *
 * Each config centralizes, in one place per entity, the four things that
 * used to be hand-duplicated: the row→DTO mapper, the insert-values
 * builder (shared by POST and YAML import-insert), the full-replace
 * editable-fields builder (shared by YAML import-update), and the
 * row→YAML-create mapper (used by export).
 */

import type { z } from '@hono/zod-openapi';
import { type SQL, asc } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  type LibraryItemCreate,
  type LibraryItemOut,
  type LibraryItemUpdate,
  type LibrarySkillCreate,
  type LibrarySkillOut,
  type LibrarySkillUpdate,
  type LibrarySpellCreate,
  type LibrarySpellOut,
  type LibrarySpellUpdate,
  type LibraryTraitCreate,
  type LibraryTraitOut,
  type LibraryTraitUpdate,
  libraryItemCreate,
  libraryItemOut,
  libraryItemUpdate,
  librarySkillCreate,
  librarySkillOut,
  librarySkillUpdate,
  librarySpellCreate,
  librarySpellOut,
  librarySpellUpdate,
  libraryTraitCreate,
  libraryTraitOut,
  libraryTraitUpdate,
} from '../../shared/schemas/campaignLibrary.ts';
import {
  campaignLibraryItems,
  campaignLibrarySkills,
  campaignLibrarySpells,
  campaignLibraryTraits,
} from '../db/schema.ts';

/** The columns every campaign-library table needs for the generic factory. */
export type LibraryTable = PgTable & {
  readonly id: AnyPgColumn;
  readonly campaignId: AnyPgColumn;
};

export interface LibraryEntityConfig<
  TTable extends LibraryTable,
  TCreate,
  TUpdate,
  TOut,
  TParamName extends string = string,
> {
  /** URL segment: `/campaigns/{id}/library/{pathSegment}`. */
  readonly pathSegment: string;
  /** Path param name for the item id, e.g. `traitId`. */
  readonly paramName: TParamName;
  /** Singular label used in 404 messages: `"<entityLabel> not found"`. */
  readonly entityLabel: string;
  /** Key into the YAML doc's `library` object and the import-result payload. */
  readonly yamlKey: 'traits' | 'skills' | 'spells' | 'items';
  readonly table: TTable;
  /** List ordering for `GET /campaigns/{id}/library`. */
  readonly orderBy: readonly SQL[];
  // The `any` third (Input) type param is deliberate: these fields hold the
  // real exported schemas (e.g. `libraryTraitCreate`), whose Zod *input*
  // type (pre-default-resolution) differs from its *output* type (T).
  // Constraining Input to `T` here would reject every schema with a
  // `.default()`, so only the output shape — the one callers actually see
  // from `.parse()` / `c.req.valid()` — is pinned.
  readonly createSchema: z.ZodType<TCreate, z.ZodTypeDef, unknown>;
  readonly updateSchema: z.ZodType<TUpdate, z.ZodTypeDef, unknown>;
  readonly outSchema: z.ZodType<TOut, z.ZodTypeDef, unknown>;
  /** Numeric/decimal columns that need `String(...)` before a Drizzle `.set()`. */
  readonly stringifyKeys?: readonly string[];
  readonly summaries: {
    readonly post: string;
    readonly patch: string;
    readonly delete: string;
  };
  readonly toOut: (row: TTable['$inferSelect']) => TOut;
  /** Natural key for YAML upsert matching (lowercased name, +kind for traits). */
  readonly keyOf: (input: { readonly name: string; readonly kind?: string }) => string;
  /** Values for a new row — shared by the POST route and YAML import-insert. */
  readonly toInsertValues: (campaignId: string, body: TCreate) => TTable['$inferInsert'];
  /** Full-replace editable fields — used by YAML import-update (not PATCH, which diffs via `buildPatchSet`). */
  readonly toUpdateValues: (body: TCreate) => Record<string, unknown>;
  /** Row → YAML-create shape, used by the export mapper. */
  readonly rowToCreate: (row: TTable['$inferSelect']) => TCreate;
}

// ===================== traits =====================

function traitEditableFields(body: LibraryTraitCreate) {
  return {
    basePoints: body.basePoints ?? 0,
    pointsPerLevel: body.pointsPerLevel ?? null,
    maxLevel: body.maxLevel ?? null,
    description: body.description ?? null,
    source: body.source ?? null,
    availableModifiers: body.availableModifiers ?? [],
    variants: body.variants ?? [],
    effects: body.effects ?? [],
    tags: body.tags ?? [],
  };
}

export const traitEntity: LibraryEntityConfig<
  typeof campaignLibraryTraits,
  LibraryTraitCreate,
  LibraryTraitUpdate,
  LibraryTraitOut,
  'traitId'
> = {
  pathSegment: 'traits',
  paramName: 'traitId',
  entityLabel: 'trait',
  yamlKey: 'traits',
  table: campaignLibraryTraits,
  orderBy: [asc(campaignLibraryTraits.kind), asc(campaignLibraryTraits.name)],
  createSchema: libraryTraitCreate,
  updateSchema: libraryTraitUpdate,
  outSchema: libraryTraitOut,
  summaries: {
    post: 'Add a library trait (owner only)',
    patch: 'Update a library trait (owner only)',
    delete: 'Delete a library trait (owner only)',
  },
  toOut: (row) =>
    libraryTraitOut.parse({
      id: row.id,
      campaignId: row.campaignId,
      name: row.name,
      kind: row.kind,
      basePoints: row.basePoints,
      pointsPerLevel: row.pointsPerLevel,
      maxLevel: row.maxLevel,
      description: row.description,
      source: row.source,
      availableModifiers: row.availableModifiers ?? [],
      variants: row.variants ?? [],
      effects: row.effects ?? [],
      tags: row.tags ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  keyOf: (input) => `${input.kind}::${input.name.toLowerCase()}`,
  toInsertValues: (campaignId, body) => ({
    campaignId,
    name: body.name,
    kind: body.kind,
    ...traitEditableFields(body),
  }),
  toUpdateValues: (body) => traitEditableFields(body),
  rowToCreate: (row) =>
    libraryTraitCreate.parse({
      name: row.name,
      kind: row.kind,
      basePoints: row.basePoints,
      pointsPerLevel: row.pointsPerLevel ?? undefined,
      maxLevel: row.maxLevel ?? undefined,
      description: row.description ?? undefined,
      source: row.source ?? undefined,
      availableModifiers: row.availableModifiers ?? [],
      variants: row.variants ?? [],
      effects: row.effects ?? [],
      tags: row.tags ?? [],
    }),
};

// ===================== skills =====================

function skillEditableFields(body: LibrarySkillCreate) {
  return {
    attribute: body.attribute,
    difficulty: body.difficulty,
    techLevel: body.techLevel ?? null,
    description: body.description ?? null,
    source: body.source ?? null,
    defaultSpecialization: body.defaultSpecialization ?? null,
    prerequisites: body.prerequisites ?? null,
    situationalModifiers: body.situationalModifiers ?? [],
    effects: body.effects ?? [],
  };
}

export const skillEntity: LibraryEntityConfig<
  typeof campaignLibrarySkills,
  LibrarySkillCreate,
  LibrarySkillUpdate,
  LibrarySkillOut,
  'skillId'
> = {
  pathSegment: 'skills',
  paramName: 'skillId',
  entityLabel: 'skill',
  yamlKey: 'skills',
  table: campaignLibrarySkills,
  orderBy: [asc(campaignLibrarySkills.name)],
  createSchema: librarySkillCreate,
  updateSchema: librarySkillUpdate,
  outSchema: librarySkillOut,
  summaries: {
    post: 'Add a library skill (owner only)',
    patch: 'Update a library skill (owner only)',
    delete: 'Delete a library skill (owner only)',
  },
  toOut: (row) =>
    librarySkillOut.parse({
      id: row.id,
      campaignId: row.campaignId,
      name: row.name,
      attribute: row.attribute,
      difficulty: row.difficulty,
      techLevel: row.techLevel,
      description: row.description,
      source: row.source,
      defaultSpecialization: row.defaultSpecialization,
      prerequisites: row.prerequisites,
      situationalModifiers: row.situationalModifiers ?? [],
      effects: row.effects ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  keyOf: (input) => input.name.toLowerCase(),
  toInsertValues: (campaignId, body) => ({
    campaignId,
    name: body.name,
    ...skillEditableFields(body),
  }),
  toUpdateValues: (body) => skillEditableFields(body),
  rowToCreate: (row) =>
    librarySkillCreate.parse({
      name: row.name,
      attribute: row.attribute,
      difficulty: row.difficulty,
      techLevel: row.techLevel ?? undefined,
      description: row.description ?? undefined,
      source: row.source ?? undefined,
      defaultSpecialization: row.defaultSpecialization ?? undefined,
      prerequisites: row.prerequisites ?? undefined,
      situationalModifiers: row.situationalModifiers ?? [],
      effects: row.effects ?? [],
    }),
};

// ===================== spells =====================

function spellEditableFields(body: LibrarySpellCreate) {
  return {
    college: body.college ?? null,
    difficulty: body.difficulty ?? 'H',
    baseEnergyCost: body.baseEnergyCost ?? 1,
    maintenanceCost: body.maintenanceCost ?? null,
    castingTime: body.castingTime ?? null,
    duration: body.duration ?? null,
    prerequisites: body.prerequisites ?? null,
    description: body.description ?? null,
    source: body.source ?? null,
  };
}

export const spellEntity: LibraryEntityConfig<
  typeof campaignLibrarySpells,
  LibrarySpellCreate,
  LibrarySpellUpdate,
  LibrarySpellOut,
  'spellId'
> = {
  pathSegment: 'spells',
  paramName: 'spellId',
  entityLabel: 'spell',
  yamlKey: 'spells',
  table: campaignLibrarySpells,
  orderBy: [asc(campaignLibrarySpells.name)],
  createSchema: librarySpellCreate,
  updateSchema: librarySpellUpdate,
  outSchema: librarySpellOut,
  summaries: {
    post: 'Add a library spell (owner only)',
    patch: 'Update a library spell (owner only)',
    delete: 'Delete a library spell (owner only)',
  },
  toOut: (row) =>
    librarySpellOut.parse({
      id: row.id,
      campaignId: row.campaignId,
      name: row.name,
      college: row.college,
      difficulty: row.difficulty,
      baseEnergyCost: row.baseEnergyCost,
      maintenanceCost: row.maintenanceCost,
      castingTime: row.castingTime,
      duration: row.duration,
      prerequisites: row.prerequisites,
      description: row.description,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  keyOf: (input) => input.name.toLowerCase(),
  toInsertValues: (campaignId, body) => ({
    campaignId,
    name: body.name,
    ...spellEditableFields(body),
  }),
  toUpdateValues: (body) => spellEditableFields(body),
  rowToCreate: (row) =>
    librarySpellCreate.parse({
      name: row.name,
      college: row.college ?? undefined,
      difficulty: row.difficulty,
      baseEnergyCost: row.baseEnergyCost,
      maintenanceCost: row.maintenanceCost ?? undefined,
      castingTime: row.castingTime ?? undefined,
      duration: row.duration ?? undefined,
      prerequisites: row.prerequisites ?? undefined,
      description: row.description ?? undefined,
      source: row.source ?? undefined,
    }),
};

// ===================== items =====================

function itemEditableFields(body: LibraryItemCreate) {
  return {
    category: body.category ?? 'general',
    defaultQuantity: body.defaultQuantity ?? 1,
    weightLbs: String(body.weightLbs ?? 0),
    cost: String(body.cost ?? 0),
    description: body.description ?? null,
    source: body.source ?? null,
    isArmor: body.isArmor ?? false,
    armor: body.armor ?? null,
    weaponData: body.weaponData ?? null,
    isContainer: body.isContainer ?? false,
    hideawayCapacityLbs: String(body.hideawayCapacityLbs ?? 0),
    weightReductionPercent: body.weightReductionPercent ?? 0,
    powerstoneData: body.powerstoneData ?? null,
    magicItemData: body.magicItemData ?? null,
  };
}

export const itemEntity: LibraryEntityConfig<
  typeof campaignLibraryItems,
  LibraryItemCreate,
  LibraryItemUpdate,
  LibraryItemOut,
  'itemId'
> = {
  pathSegment: 'items',
  paramName: 'itemId',
  entityLabel: 'item',
  yamlKey: 'items',
  table: campaignLibraryItems,
  orderBy: [asc(campaignLibraryItems.name)],
  createSchema: libraryItemCreate,
  updateSchema: libraryItemUpdate,
  outSchema: libraryItemOut,
  stringifyKeys: ['weightLbs', 'cost', 'hideawayCapacityLbs'],
  summaries: {
    post: 'Add a library item (owner only)',
    patch: 'Update a library item (owner only)',
    delete: 'Delete a library item (owner only)',
  },
  toOut: (row) =>
    libraryItemOut.parse({
      id: row.id,
      campaignId: row.campaignId,
      name: row.name,
      category: row.category,
      defaultQuantity: row.defaultQuantity,
      weightLbs: Number(row.weightLbs),
      cost: Number(row.cost),
      description: row.description,
      source: row.source,
      isArmor: row.isArmor,
      armor: row.armor ?? null,
      weaponData: row.weaponData ?? null,
      isContainer: row.isContainer,
      hideawayCapacityLbs: Number(row.hideawayCapacityLbs),
      weightReductionPercent: row.weightReductionPercent,
      powerstoneData: row.powerstoneData ?? null,
      magicItemData: row.magicItemData ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  keyOf: (input) => input.name.toLowerCase(),
  toInsertValues: (campaignId, body) => ({
    campaignId,
    name: body.name,
    ...itemEditableFields(body),
  }),
  toUpdateValues: (body) => itemEditableFields(body),
  rowToCreate: (row) =>
    libraryItemCreate.parse({
      name: row.name,
      category: row.category,
      defaultQuantity: row.defaultQuantity,
      weightLbs: Number(row.weightLbs),
      cost: Number(row.cost),
      description: row.description ?? undefined,
      source: row.source ?? undefined,
      isArmor: row.isArmor,
      armor: row.armor ?? undefined,
      weaponData: row.weaponData ?? undefined,
      isContainer: row.isContainer,
      hideawayCapacityLbs: Number(row.hideawayCapacityLbs),
      weightReductionPercent: row.weightReductionPercent,
      powerstoneData: row.powerstoneData ?? undefined,
      magicItemData: row.magicItemData ?? undefined,
    }),
};

/** All four entity configs, in the order routes/list/export/import must process them. */
export const libraryEntities = [traitEntity, skillEntity, spellEntity, itemEntity] as const;
