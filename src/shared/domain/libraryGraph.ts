import type { RuleReference } from '../schemas/calculation.ts';
import type { LibraryMetadata } from '../schemas/libraryMetadata.ts';
import { canonicalLibraryKey, libraryEntryKey } from './libraryIdentity.ts';
import {
  type PricedDefinition,
  type PricingCatalog,
  findPricedDefinition,
  validatePricingCatalog,
} from './libraryPricing.ts';

export type LibraryGraphEntry = {
  abbreviation?: string | undefined;
  edition?: string | null | undefined;
  priority?: number | undefined;
  notes?: string | null | undefined;
} & PricedDefinition &
  LibraryMetadata & { applicability?: { traits: RuleReference[] } | string | undefined };
export type LibraryGraph = Record<string, readonly LibraryGraphEntry[]>;

function sourceIdentity(entry: LibraryGraphEntry): string {
  if (!entry.id) throw new Error(`Sourcebook UUID required for ${entry.name}`);
  return entry.id;
}

/** Validate the resulting library, not merely the rows carried by a patch/import. */
export function validateLibraryGraph(graph: LibraryGraph): void {
  const sources = new Set((graph.sources ?? []).map((s) => s.id));
  for (const [section, entries] of Object.entries(graph)) {
    const identities = new Set<string>();
    const preferred = new Set<string>();
    for (const entry of entries) {
      const key = section === 'sources' ? sourceIdentity(entry) : libraryEntryKey(entry);
      if (identities.has(key)) throw new Error(`Duplicate ${section} edition: ${entry.name}`);
      identities.add(key);
      if (section === 'sources') continue;
      if (entry.sourceId && !sources.has(entry.sourceId))
        throw new Error(`Unknown source ${entry.sourceId} for ${entry.name}`);
      if (entry.preferredEdition) {
        const canonical = JSON.stringify([
          entry.kind ?? '',
          canonicalLibraryKey(entry.key || entry.name),
        ]);
        if (preferred.has(canonical))
          throw new Error(`Multiple preferred editions of ${entry.name}`);
        preferred.add(canonical);
      }
    }
  }
  const pricing: PricingCatalog = {
    traits: graph.traits ?? [],
    items: graph.items ?? [],
    modifiers: graph.modifiers ?? [],
  };
  validatePricingCatalog(pricing);
  for (const modifier of graph.modifiers ?? []) {
    if (typeof modifier.applicability !== 'object') continue;
    for (const ref of modifier.applicability.traits) {
      if (ref.section !== 'traits' || !findPricedDefinition(pricing, ref))
        throw new Error(`Unresolved applicability reference in ${modifier.name}: ${ref.key}`);
    }
  }
}

export function mergeLibraryGraph(
  current: LibraryGraph,
  incoming: LibraryGraph,
  mode: 'merge' | 'replace',
  sourceIds?: readonly string[],
): LibraryGraph {
  const result = { ...current };
  const scope = sourceIds && new Set(sourceIds);
  for (const [section, rows] of Object.entries(incoming)) {
    if (rows === undefined) continue;
    if (mode === 'replace') {
      result[section] = scope
        ? section === 'sources'
          ? [...(current[section] ?? []).filter((row) => !scope.has(row.id ?? '')), ...rows]
          : [...(current[section] ?? []).filter((row) => !scope.has(row.sourceId ?? '')), ...rows]
        : rows;
      continue;
    }
    const keyOf = (entry: LibraryGraphEntry) =>
      section === 'sources' ? sourceIdentity(entry) : libraryEntryKey(entry);
    const merged = new Map((current[section] ?? []).map((row) => [keyOf(row), row]));
    for (const row of rows) merged.set(keyOf(row), row);
    result[section] = [...merged.values()];
  }
  return result;
}

export function libraryEditionDecisions(current: LibraryGraph, incoming: LibraryGraph) {
  return Object.entries(incoming).flatMap(([section, rows]) =>
    section === 'sources'
      ? []
      : (rows ?? []).flatMap((entry) => {
          const siblings = (current[section] ?? []).filter(
            (row) =>
              (row.kind ?? '') === (entry.kind ?? '') &&
              canonicalLibraryKey(row.key || row.name) ===
                canonicalLibraryKey(entry.key || entry.name),
          );
          if (siblings.length === 0) return [];
          return [
            {
              section,
              key: entry.key || canonicalLibraryKey(entry.name),
              sourceId: entry.sourceId ?? null,
              decision: siblings.some((row) => libraryEntryKey(row) === libraryEntryKey(entry))
                ? ('update_edition' as const)
                : ('create_separate_edition' as const),
            },
          ];
        }),
  );
}
