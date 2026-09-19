/** Device-only table presentation. Stores IDs, never character/weapon contents. */
export type AttackSort = 'custom' | 'weapon' | 'skill' | 'type';

export interface AttackTablePreferences {
  order: string[];
  sort: AttackSort;
  descending: boolean;
}

const PREFIX = 'gurps:attackTable:';

export function readAttackTablePreferences(characterId: string): AttackTablePreferences {
  const fallback: AttackTablePreferences = { order: [], sort: 'custom', descending: false };
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
        typeof value.sort === 'string' && ['custom', 'weapon', 'skill', 'type'].includes(value.sort)
          ? (value.sort as AttackSort)
          : 'custom',
      descending: value.descending === true,
    };
  } catch {
    return fallback;
  }
}

export function saveAttackTablePreferences(
  characterId: string,
  preferences: AttackTablePreferences,
): boolean {
  try {
    localStorage.setItem(`${PREFIX}${characterId}`, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearAllAttackTablePreferences(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
