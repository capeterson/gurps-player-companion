/**
 * Convenience wrapper combining `useCharacterFieldSave` (outbox
 * enqueue) with `useDraftField` (draft-on-blur).  Most call sites in
 * the character sheet just want a typed draft field that saves to the
 * outbox -- this hook spares them from wiring `flashKey` and `onSave`
 * manually.
 */

import type { EntityClass } from '../../../../shared/schemas/sync.ts';
import { type UseDraftFieldOptions, useDraftField } from '../../../hooks/useDraftField.ts';
import { useCharacterFieldSave } from './useCharacterPatch.ts';

export interface UseCharacterFieldDraftOptions<V>
  extends Omit<UseDraftFieldOptions<V>, 'onSave' | 'flashKey'> {
  readonly characterId: string;
  /** Field path (or whole-body for combat). */
  readonly field: string;
  /**
   * Defaults to `character`.  Trait / skill / inventory panels pass
   * their entity class so the outbox routes the patch correctly.
   */
  readonly entityClass?: EntityClass | undefined;
  /**
   * Defaults to `characterId`.  For child entities pass the row id
   * (trait/skill/item id, or the characterId for combat which is 1:1).
   */
  readonly entityId?: string | undefined;
}

export function useCharacterFieldDraft<V>(opts: UseCharacterFieldDraftOptions<V>) {
  const buildSave = useCharacterFieldSave(opts.characterId);
  const saver = buildSave(opts.field, {
    entityClass: opts.entityClass,
    entityId: opts.entityId,
    humanName: opts.name,
  });
  return useDraftField<V>({
    ...opts,
    onSave: saver.onSave,
    flashKey: saver.flashKey,
  });
}
