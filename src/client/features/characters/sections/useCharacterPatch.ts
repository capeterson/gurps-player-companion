/**
 * Shared helpers for PATCHing the parent character.  Returns a save
 * factory: each call produces an `onSave` for one field that triggers
 * a refetch of the canonical character detail.
 *
 * We deliberately do NOT `setQueryData` with the mutation response.
 * Two saves in flight on different fields each return a full
 * `CharacterDetail`; if the older response arrives last, an unconditional
 * cache write would overwrite the newer field's value, which
 * `useDraftField` would then silently sync back into the input.  Letting
 * TanStack Query refetch instead serializes through the query client and
 * always pulls the latest committed state.
 */

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { api } from '../../../lib/api.ts';

export function characterDetailKey(id: string) {
  return ['characters', id, 'detail'] as const;
}

/**
 * Mark the character detail (and the list query) as stale so TanStack
 * Query refetches.  `_detail` is accepted but ignored — see file header.
 */
export function applyDetailToCache(qc: QueryClient, id: string, _detail: CharacterDetail): void {
  qc.invalidateQueries({ queryKey: characterDetailKey(id) });
  qc.invalidateQueries({ queryKey: ['characters'], exact: true });
}

export function useFieldSaver(id: string) {
  const qc = useQueryClient();
  return useCallback(
    (field: string) => async (value: unknown) => {
      const detail = await api<CharacterDetail>(`/characters/${id}`, {
        method: 'PATCH',
        body: { [field]: value },
      });
      applyDetailToCache(qc, id, detail);
    },
    [id, qc],
  );
}
