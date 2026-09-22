/** Device-only trait-table presentation. Stores row IDs, never character contents. */
export type TraitSort = 'custom' | 'name' | 'kind' | 'points' | 'level';

export interface TraitTablePreferences {
  order: string[];
  sort: TraitSort;
  descending: boolean;
}

const PREFIX = 'gurps:traitTable:';

export function readTraitTablePreferences(characterId: string): TraitTablePreferences {
  const fallback: TraitTablePreferences = { order: [], sort: 'name', descending: false };
  try {
    const raw = localStorage.getItem(`${PREFIX}${characterId}`);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const value = parsed as Record<string, unknown>;
    return {
      order: Array.isArray(value.order)
        ? [...new Set(value.order.filter((id): id is string => typeof id === 'string'))]
        : [],
      sort:
        typeof value.sort === 'string' &&
        ['custom', 'name', 'kind', 'points', 'level'].includes(value.sort)
          ? (value.sort as TraitSort)
          : 'name',
      descending: value.descending === true,
    };
  } catch {
    return fallback;
  }
}

export function saveTraitTablePreferences(
  characterId: string,
  preferences: TraitTablePreferences,
): boolean {
  try {
    localStorage.setItem(`${PREFIX}${characterId}`, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearAllTraitTablePreferences(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
