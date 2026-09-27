import type { LibraryMetadata, LibraryModifierCreate } from '../schemas/libraryMetadata.ts';

export const canonicalLibraryKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
export function libraryEntryKey(
  entry: LibraryMetadata & { name: string; kind?: string | undefined },
) {
  return JSON.stringify([
    entry.kind ?? '',
    canonicalLibraryKey(entry.key || entry.name),
    canonicalLibraryKey(entry.sourceKey ?? ''),
  ]);
}
export function libraryMetadataValues(entry: LibraryMetadata & { name: string }) {
  return {
    key: canonicalLibraryKey(entry.key || entry.name),
    sourceKey: entry.sourceKey ? canonicalLibraryKey(entry.sourceKey) : null,
    sourceLocator: entry.sourceLocator ?? null,
    status: entry.status ?? 'complete',
    role: entry.role ?? 'definition',
    preferredEdition: entry.preferredEdition ?? false,
    extraction: entry.extraction ?? null,
  };
}
export function canAdoptLibraryEntry(entry: LibraryMetadata): boolean {
  return (
    (entry.status ?? 'complete') === 'complete' &&
    ['definition', 'template'].includes(entry.role ?? 'definition')
  );
}
export function preferredLibraryEditions<
  T extends LibraryMetadata & { name: string; kind?: string | undefined },
>(entries: readonly T[], sources: readonly { key: string; priority: number }[]): T[] {
  const priorities = new Map(sources.map((s) => [canonicalLibraryKey(s.key), s.priority]));
  const selected = new Map<string, T>();
  function compare(a: T, b: T) {
    return (
      Number(b.preferredEdition ?? false) - Number(a.preferredEdition ?? false) ||
      (priorities.get(canonicalLibraryKey(a.sourceKey ?? '')) ?? 100000) -
        (priorities.get(canonicalLibraryKey(b.sourceKey ?? '')) ?? 100000) ||
      ((a.sourceKey ?? '') < (b.sourceKey ?? '')
        ? -1
        : (a.sourceKey ?? '') > (b.sourceKey ?? '')
          ? 1
          : 0)
    );
  }
  for (const entry of entries) {
    const key = JSON.stringify([entry.kind ?? '', canonicalLibraryKey(entry.key || entry.name)]);
    const previous = selected.get(key);
    if (!previous || compare(entry, previous) < 0) selected.set(key, entry);
  }
  return [...selected.values()];
}
export function modifierApplies(
  modifier: Pick<LibraryModifierCreate, 'applicability'>,
  trait: LibraryMetadata & { name: string; kind: string; tags?: string[] },
): boolean {
  const a = modifier.applicability;
  return (
    a.universal ||
    a.traitKinds.some((k) => k === trait.kind) ||
    a.traitTags.some((t) => trait.tags?.includes(t)) ||
    a.traits.some(
      (t) =>
        t.section === 'traits' &&
        canonicalLibraryKey(t.key) === canonicalLibraryKey(trait.key || trait.name) &&
        canonicalLibraryKey(t.sourceKey ?? '') === canonicalLibraryKey(trait.sourceKey ?? '') &&
        (!t.kind || t.kind === trait.kind),
    )
  );
}
