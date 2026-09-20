/** Device-only defense table presentation. Stores row IDs, never character contents. */
export type DefenseSort = 'custom' | 'defense' | 'skill' | 'final';

export interface DefenseTablePreferences {
  order: string[];
  sort: DefenseSort;
  descending: boolean;
}

const PREFIX = 'gurps:defenseTable:';

export function readDefenseTablePreferences(characterId: string): DefenseTablePreferences {
  const fallback: DefenseTablePreferences = { order: [], sort: 'custom', descending: false };
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
        ['custom', 'defense', 'skill', 'final'].includes(value.sort)
          ? (value.sort as DefenseSort)
          : 'custom',
      descending: value.descending === true,
    };
  } catch {
    return fallback;
  }
}

export function saveDefenseTablePreferences(
  characterId: string,
  preferences: DefenseTablePreferences,
): boolean {
  try {
    localStorage.setItem(`${PREFIX}${characterId}`, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearAllDefenseTablePreferences(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
