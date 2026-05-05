/**
 * Generic shift-click range-select.
 *
 *   Plain click       → replace the selection with just this item, and
 *                       set the anchor to it.
 *   Cmd/Ctrl-click    → toggle this item without moving the anchor.
 *   Shift-click       → select every item between the anchor and the
 *                       clicked item (inclusive). If no anchor, treat
 *                       as a plain click.
 *
 * The hook is keyed by the items' stable `id`s; reordering or
 * deleting items is safe because we re-derive the anchor index from
 * the current order on every click.
 *
 * Mirrors `gurps-player-web`'s legacy hook so playtesters' muscle
 * memory carries over.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

export type RangeSelectClickEvent = Pick<
  React.MouseEvent | KeyboardEvent,
  'shiftKey' | 'metaKey' | 'ctrlKey'
>;

export interface UseRangeSelectReturn {
  readonly selectedIds: ReadonlySet<string>;
  readonly count: number;
  isSelected(id: string): boolean;
  handleClick(id: string, event: RangeSelectClickEvent): void;
  clear(): void;
  replace(ids: Iterable<string>): void;
}

export function useRangeSelect(orderedIds: readonly string[]): UseRangeSelectReturn {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  const idIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [orderedIds]);

  const handleClick = useCallback(
    (id: string, event: RangeSelectClickEvent) => {
      const idx = idIndex.get(id);
      if (idx === undefined) return;

      setSelected((prev) => {
        if (event.shiftKey && anchorRef.current && idIndex.has(anchorRef.current)) {
          const next = new Set(prev);
          const anchorIdx = idIndex.get(anchorRef.current);
          if (anchorIdx === undefined) return next;
          const [from, to] = anchorIdx < idx ? [anchorIdx, idx] : [idx, anchorIdx];
          // If the anchor is currently selected, shift-click EXTENDS;
          // otherwise it CONTRACTS. Matches Finder/Files-app intuition.
          const extending = next.has(anchorRef.current);
          for (let i = from; i <= to; i++) {
            const otherId = orderedIds[i];
            if (!otherId) continue;
            if (extending) next.add(otherId);
            else next.delete(otherId);
          }
          return next;
        }

        if (event.metaKey || event.ctrlKey) {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }

        anchorRef.current = id;
        return new Set([id]);
      });
    },
    [idIndex, orderedIds],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const replace = useCallback((ids: Iterable<string>) => {
    setSelected(new Set(ids));
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selectedIds: selected,
    isSelected,
    handleClick,
    clear,
    replace,
    count: selected.size,
  };
}
