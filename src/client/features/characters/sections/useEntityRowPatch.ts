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

import { type ChangeEvent, useCallback } from 'react';
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
 * Select-driven companion to `useEntityNameField`: a `<select>` bound to
 * an enum column on a row entity (language fluency, technique
 * difficulty).
 *
 * Deliberately a thin wrapper over `useDraftField` rather than a second
 * draft pattern (AGENTS.md S10): the only difference from a text input
 * is that a select commits on *change* instead of on blur, so `onChange`
 * calls `setValue` (which updates the hook's draft ref synchronously)
 * and then `commit()`. Queued same-field commits, per-field server
 * sync, and the toast + flash rollback all come from the hook unchanged.
 */
export interface EntityEnumFieldReturn {
  readonly value: string;
  readonly isSaving: boolean;
  readonly selectProps: {
    readonly value: string;
    readonly onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
    readonly 'data-flashing': 'true' | 'false';
    readonly 'data-flash-parity': '0' | '1';
  };
}

export function useEntityEnumField<V extends string>(
  row: EntityRowPatch,
  label: string,
  field: string,
  serverValue: V,
  allowed: readonly V[],
): EntityEnumFieldReturn {
  const draft = useDraftField<V>({
    name: label,
    serverValue,
    parse: (s) => s as V,
    validate: (v) => (allowed.includes(v) ? null : `unknown ${label}`),
    onSave: (v) => row.patch(field, v),
    flashKey: row.flashKey(field),
  });
  const { setValue, commit } = draft;
  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      setValue(e.target.value);
      commit();
    },
    [setValue, commit],
  );
  return {
    value: draft.value,
    isSaving: draft.isSaving,
    selectProps: {
      value: draft.value,
      onChange,
      'data-flashing': draft.inputProps['data-flashing'],
      'data-flash-parity': draft.inputProps['data-flash-parity'],
    },
  };
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
