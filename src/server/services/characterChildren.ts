/**
 * Library-linked character children: traits, skills, spells, languages and
 * techniques. One config per class drives the writes shared by the REST
 * sub-resource routes and the /sync/operations dispatcher (AGENTS.md S12),
 * so both doors insert, update and delete through the same code.
 *
 * Inventory keeps its own paths (container parent and cycle checks) and
 * combat state is a 1:1 upsert; both only share `CHARACTER_CHILD_TABLES`.
 */

import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { languageCreate } from '../../shared/schemas/language.ts';
import { skillCreate } from '../../shared/schemas/skill.ts';
import { spellCreate } from '../../shared/schemas/spell.ts';
import { techniqueCreate } from '../../shared/schemas/technique.ts';
import { traitCreate } from '../../shared/schemas/trait.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  characterLanguages,
  characterSkills,
  characterSpells,
  characterTechniques,
  characterTraits,
  inventoryItems,
} from '../db/schema.ts';
import {
  languageInsertValues,
  skillInsertValues,
  spellInsertValues,
  techniqueInsertValues,
  traitInsertValues,
} from './entityWrites.ts';
import { type ReferenceKind, prepareLibraryReference } from './libraryReferences.ts';

/** Tables of the id-keyed character child classes, for generic reads. */
export const CHARACTER_CHILD_TABLES = {
  character_trait: characterTraits,
  character_skill: characterSkills,
  character_spell: characterSpells,
  character_language: characterLanguages,
  character_technique: characterTechniques,
  character_inventory: inventoryItems,
} as const;

export type CharacterChildClass = keyof typeof CHARACTER_CHILD_TABLES;

export function isCharacterChildClass(entityClass: string): entityClass is CharacterChildClass {
  return Object.hasOwn(CHARACTER_CHILD_TABLES, entityClass);
}

type ChildTable = (typeof CHARACTER_CHILD_TABLES)[LibraryLinkedChildClass];

export interface LibraryLinkedChildConfig<TTable extends ChildTable, TCreate> {
  readonly table: TTable;
  readonly referenceKind: ReferenceKind;
  readonly createSchema: z.ZodType<TCreate, z.ZodTypeDef, unknown>;
  // Method syntax (bivariant) so a per-class config widens to AnyLibraryLinkedChild.
  insertValues(
    body: TCreate,
    ctx: { readonly characterId: string; readonly id?: string },
  ): TTable['$inferInsert'];
}

/** A config with its per-class types erased, for dispatch by entity class. */
export type AnyLibraryLinkedChild = LibraryLinkedChildConfig<ChildTable, unknown>;

function childConfig<TTable extends ChildTable, TCreate>(
  cfg: LibraryLinkedChildConfig<TTable, TCreate>,
): LibraryLinkedChildConfig<TTable, TCreate> {
  return cfg;
}

export const LIBRARY_LINKED_CHILDREN = {
  character_trait: childConfig({
    table: characterTraits,
    referenceKind: 'traits',
    createSchema: traitCreate,
    insertValues: traitInsertValues,
  }),
  character_skill: childConfig({
    table: characterSkills,
    referenceKind: 'skills',
    createSchema: skillCreate,
    insertValues: skillInsertValues,
  }),
  character_spell: childConfig({
    table: characterSpells,
    referenceKind: 'spells',
    createSchema: spellCreate,
    insertValues: spellInsertValues,
  }),
  character_language: childConfig({
    table: characterLanguages,
    referenceKind: 'languages',
    createSchema: languageCreate,
    insertValues: languageInsertValues,
  }),
  character_technique: childConfig({
    table: characterTechniques,
    referenceKind: 'techniques',
    createSchema: techniqueCreate,
    insertValues: techniqueInsertValues,
  }),
} as const;

export type LibraryLinkedChildClass =
  | 'character_trait'
  | 'character_skill'
  | 'character_spell'
  | 'character_language'
  | 'character_technique';

// Drizzle's builders cannot resolve overloads over a union of tables; the
// configs above keep the per-class types, and rows are cast back below.
// biome-ignore lint/suspicious/noExplicitAny: generic child table runtime object
function asTable(table: ChildTable): any {
  return table;
}

/** Scope a child row to its parent character (never a bare id match). */
export function childRowWhere(
  table: (typeof CHARACTER_CHILD_TABLES)[CharacterChildClass],
  characterId: string,
  childId: string,
) {
  return and(eq(table.id, childId), eq(table.characterId, characterId));
}

/** Insert a validated create body, preparing its library reference first. */
export async function insertCharacterChild<TTable extends ChildTable, TCreate>(
  tx: AuditTx,
  userId: string,
  cfg: LibraryLinkedChildConfig<TTable, TCreate>,
  characterId: string,
  body: TCreate,
  id?: string,
): Promise<TTable['$inferSelect']> {
  const values = await prepareLibraryReference(
    tx,
    userId,
    characterId,
    cfg.referenceKind,
    cfg.insertValues(body, id === undefined ? { characterId } : { characterId, id }),
  );
  const [created] = (await tx
    .insert(asTable(cfg.table))
    .values(values)
    .returning()) as TTable['$inferSelect'][];
  if (!created) throw new HTTPException(500, { message: 'insert failed' });
  return created;
}

/** Apply a patch set after re-checking its library reference; undefined when absent. */
export async function updateCharacterChild<TTable extends ChildTable, TCreate>(
  tx: AuditTx,
  userId: string,
  cfg: LibraryLinkedChildConfig<TTable, TCreate>,
  characterId: string,
  childId: string,
  updates: Record<string, unknown>,
): Promise<TTable['$inferSelect'] | undefined> {
  const prepared = await prepareLibraryReference(
    tx,
    userId,
    characterId,
    cfg.referenceKind,
    updates,
    childId,
  );
  const [updated] = (await tx
    .update(asTable(cfg.table))
    .set(prepared)
    .where(childRowWhere(cfg.table, characterId, childId))
    .returning()) as TTable['$inferSelect'][];
  return updated;
}

/** Delete a child row; returns whether a row was removed. */
export async function deleteCharacterChild(
  tx: AuditTx,
  cfg: AnyLibraryLinkedChild,
  characterId: string,
  childId: string,
): Promise<boolean> {
  const removed = (await tx
    .delete(asTable(cfg.table))
    .where(childRowWhere(cfg.table, characterId, childId))
    .returning({ id: cfg.table.id })) as { id: string }[];
  return removed.length > 0;
}
