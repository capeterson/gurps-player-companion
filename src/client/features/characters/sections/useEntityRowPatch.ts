/**
 * Row-level field patching for character sub-entities (skills, spells,
 * traits, ...). SkillRow/SpellRow/TraitRow each used to hand-roll a
 * verbatim `patchX(field, value)` closure around `enqueueFieldPatch`
 * that bypassed `useCharacterFieldSave` — this hook routes them
 * through it instead, and bundles the matching `flashKey(field)`
 * lookup so callers don't have to repeat `entityClass`/`entityId` at
 * every `useDraftField` call site.
 *
 * `useEntityNameField` / `useEntityPointsField` below are the shared
 * `useDraftField` configs for the name/points inputs that
 * SkillRow/SpellRow/TraitRow all have. Per AGENTS.md, panels keep
 * their own exact validation messages — `useEntityPointsField` takes
 * `parse` as a parameter rather than hard-coding one, so
 * SkillsPanel's "non-negative integer only", SpellsPanel's "positive
 * integer only", and TraitsPanel's unbounded intParser all stay
 * verbatim.
 */

import { useCallback } from 'react';
import type { EntityClass } from '../../../../shared/schemas/sync.ts';
import { type UseDraftFieldReturn, useDraftField } from '../../../hooks/useDraftField.ts';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { useCharacterFieldSave } from './useCharacterPatch.ts';

export interface EntityRowPatch {
  /** Patch one field on this row's entity. Mirrors the old `patchX(field, value)` closures. */
  readonly patch: (field: string, value: unknown) => Promise<void>;
  /** The flash-bus key for a given field on this row's entity. */
  readonly flashKey: (field: string) => string;
}

/**
 * Build a `{ patch, flashKey }` pair scoped to one row entity (a
 * single skill/spell/trait/etc.), backed by `useCharacterFieldSave`
 * instead of a bespoke `enqueueFieldPatch` call.
 */
export function useEntityRowPatch(
  entityClass: EntityClass,
  entityId: string,
  characterId: string,
  entityName: string,
): EntityRowPatch {
  const fieldSave = useCharacterFieldSave(characterId);

  const patch = useCallback(
    (field: string, value: unknown) =>
      fieldSave(field, { entityClass, entityId, humanName: `${entityName} ${field}` }).onSave(
        value,
      ),
    [fieldSave, entityClass, entityId, entityName],
  );

  const flashKey = useCallback(
    (field: string) => makeFlashKey(entityClass, entityId, field),
    [entityClass, entityId],
  );

  return { patch, flashKey };
}

/** Shared `useDraftField` config for the "name" input on a row entity. */
export function useEntityNameField(row: EntityRowPatch, entityName: string): UseDraftFieldReturn {
  return useDraftField<string>({
    name: `${entityName} name`,
    serverValue: entityName,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: (v) => row.patch('name', v),
    flashKey: row.flashKey('name'),
  });
}

/**
 * Shared `useDraftField` config for the "points" input on a row
 * entity. `parse` is supplied by the caller so each panel keeps its
 * own exact validation message.
 */
export function useEntityPointsField(
  row: EntityRowPatch,
  entityName: string,
  serverValue: number,
  parse: (s: string) => number,
): UseDraftFieldReturn {
  return useDraftField<number>({
    name: `${entityName} points`,
    serverValue,
    parse,
    onSave: (v) => row.patch('points', v),
    flashKey: row.flashKey('points'),
  });
}
