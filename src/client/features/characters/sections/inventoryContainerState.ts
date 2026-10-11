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

const GROUP_PREFIX = 'gpc:inventory-type-group-expanded';

/** Type sections are a view, not containers; they start open. */
export function readTypeGroupExpanded(characterId: string, list: string, type: string): boolean {
  try {
    return (
      window.localStorage.getItem(`${GROUP_PREFIX}:${characterId}:${list}:${type}`) !== 'false'
    );
  } catch {
    return true;
  }
}

export function writeTypeGroupExpanded(
  characterId: string,
  list: string,
  type: string,
  expanded: boolean,
): void {
  try {
    window.localStorage.setItem(`${GROUP_PREFIX}:${characterId}:${list}:${type}`, String(expanded));
  } catch {
    // The in-memory disclosure still works for the current render.
  }
}
