const SEARCHED_FIELDS = [
  'name',
  'description',
  'source',
  'kind',
  'attribute',
  'difficulty',
  'college',
  'prerequisites',
  'specializationPolicy',
  'tags',
  'applicability',
  'stackingPolicy',
] as const;

/**
 * Haystacks are cached per entry object. React Query's structural sharing keeps
 * unchanged rows referentially stable across refetches, so each entry is
 * flattened once per change rather than once per keystroke.
 */
const haystacks = new WeakMap<object, string>();

function strings(value: unknown): string[] {
  return typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];
}

function haystackFor(entry: object): string {
  let haystack = haystacks.get(entry);
  if (haystack === undefined) {
    const fields = entry as Record<string, unknown>;
    haystack = SEARCHED_FIELDS.flatMap((key) => strings(fields[key]))
      .join(' ')
      .toLocaleLowerCase();
    haystacks.set(entry, haystack);
  }
  return haystack;
}

/** Normalize a query once so a list filter doesn't re-split it for every entry. */
export function librarySearchWords(query: string): string[] {
  const trimmed = query.trim().toLocaleLowerCase();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/** Match all query words against the human-readable library fields, never IDs. */
export function matchesLibrarySearch(entry: object, query: string | readonly string[]): boolean {
  const words = typeof query === 'string' ? librarySearchWords(query) : query;
  if (words.length === 0) return true;
  const haystack = haystackFor(entry);
  return words.every((word) => haystack.includes(word));
}
