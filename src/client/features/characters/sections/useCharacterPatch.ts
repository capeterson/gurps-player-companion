/**
 * Shared helpers for PATCHing the parent character.  Returns a save
 * factory: each call produces an `onSave` for one field that updates
 * the TanStack Query cache with the server's recomputed detail.
 */

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { api } from '../../../lib/api.ts';

export function characterDetailKey(id: string) {
  return ['characters', id, 'detail'] as const;
}

export function applyDetailToCache(qc: QueryClient, id: string, detail: CharacterDetail) {
  qc.setQueryData(characterDetailKey(id), detail);
  // Also invalidate the list query so name/attr edits show up immediately
  // when the user navigates back.
  qc.invalidateQueries({ queryKey: ['characters'], exact: true });
}

export function useCharacterPatch(id: string) {
  const qc = useQueryClient();
  return useCallback(
    <V>(field: string, value: V) =>
      async () => {
        const detail = await api<CharacterDetail>(`/characters/${id}`, {
          method: 'PATCH',
          body: { [field]: value },
        });
        applyDetailToCache(qc, id, detail);
      },
    [id, qc],
  );
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
