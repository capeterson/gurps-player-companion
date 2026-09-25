/** Device-only table presentation. Only row IDs and sorting choices are stored. */
export interface TablePreferences<Sort extends string> {
  order: string[];
  sort: Sort;
  descending: boolean;
}

export function tablePreferencesCodec<Sort extends string>(
  prefix: string,
  allowedSorts: readonly Sort[],
  defaultSort: Sort,
) {
  const fallback = (): TablePreferences<Sort> => ({
    order: [],
    sort: defaultSort,
    descending: false,
  });

  return {
    read(characterId: string): TablePreferences<Sort> {
      try {
        const raw = localStorage.getItem(`${prefix}${characterId}`);
        if (!raw) return fallback();
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return fallback();
        const value = parsed as Record<string, unknown>;
        return {
          order: Array.isArray(value.order)
            ? [...new Set(value.order.filter((id): id is string => typeof id === 'string'))]
            : [],
          sort:
            typeof value.sort === 'string' && allowedSorts.includes(value.sort as Sort)
              ? (value.sort as Sort)
              : defaultSort,
          descending: value.descending === true,
        };
      } catch {
        return fallback();
      }
    },
    save(characterId: string, preferences: TablePreferences<Sort>): boolean {
      try {
        localStorage.setItem(`${prefix}${characterId}`, JSON.stringify(preferences));
        return true;
      } catch {
        return false;
      }
    },
    clearAll(): void {
      try {
        const keys: string[] = [];
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        for (const key of keys) localStorage.removeItem(key);
      } catch {}
    },
  };
}
