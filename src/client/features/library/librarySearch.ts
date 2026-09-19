/** Match all query words against the human-readable library fields, never IDs. */
export function matchesLibrarySearch(entry: object, query: string): boolean {
  const fields = entry as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(strings)
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
  const haystack = [
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
  ]
    .flatMap((key) => strings(fields[key]))
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
