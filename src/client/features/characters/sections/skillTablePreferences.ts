/** Device-only skill-table presentation. Stores row IDs, never character contents. */
export type SkillSort = 'custom' | 'name' | 'basis' | 'points' | 'level';

export interface SkillTablePreferences {
  order: string[];
  sort: SkillSort;
  descending: boolean;
}

const PREFIX = 'gurps:skillTable:';

export function readSkillTablePreferences(characterId: string): SkillTablePreferences {
  const fallback: SkillTablePreferences = { order: [], sort: 'name', descending: false };
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
        ['custom', 'name', 'basis', 'points', 'level'].includes(value.sort)
          ? (value.sort as SkillSort)
          : 'name',
      descending: value.descending === true,
    };
  } catch {
    return fallback;
  }
}

export function saveSkillTablePreferences(
  characterId: string,
  preferences: SkillTablePreferences,
): boolean {
  try {
    localStorage.setItem(`${PREFIX}${characterId}`, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearAllSkillTablePreferences(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {}
}
