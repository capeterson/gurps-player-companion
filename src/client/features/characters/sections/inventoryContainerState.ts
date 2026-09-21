const PREFIX = 'gpc:inventory-container-expanded';

function storageKey(characterId: string, containerId: string): string {
  return `${PREFIX}:${characterId}:${containerId}`;
}

/** Container disclosure is device-local UI state, never character data. */
export function readContainerExpanded(characterId: string, containerId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(characterId, containerId)) === 'true';
  } catch {
    return false;
  }
}

export function writeContainerExpanded(
  characterId: string,
  containerId: string,
  expanded: boolean,
): void {
  try {
    window.localStorage.setItem(storageKey(characterId, containerId), String(expanded));
  } catch {
    // Storage can be unavailable in private or quota-constrained contexts. The
    // in-memory disclosure still works for the current render.
  }
}
