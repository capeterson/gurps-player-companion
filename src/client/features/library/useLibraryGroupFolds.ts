import { useState } from 'react';

function readClosed(storageKey: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Device-only folded state for the category groups of one library section.
 * Shares FoldSection's `gpc:fold:` namespace; groups default to open.
 */
export function useLibraryGroupFolds(preferenceKey: string) {
  const storageKey = `gpc:fold:${preferenceKey}`;
  const [state, setState] = useState(() => ({ key: storageKey, closed: readClosed(storageKey) }));
  const closed = state.key === storageKey ? state.closed : readClosed(storageKey);

  function update(group: string, open: boolean) {
    const next = new Set(closed);
    if (open) next.delete(group);
    else next.add(group);
    setState({ key: storageKey, closed: next });
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* Storage can be unavailable; folding still works for this visit. */
    }
  }

  return {
    isOpen: (group: string) => !closed.has(group),
    toggle: (group: string) => update(group, closed.has(group)),
    open: (group: string) => {
      if (closed.has(group)) update(group, true);
    },
  };
}
