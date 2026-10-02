import { z } from 'zod';
import { canonicalLibraryKey } from '../domain/libraryIdentity.ts';

/** Portable keys exist only in the YAML boundary, never in live library records. */
export type Portable<T> = T extends readonly (infer E)[]
  ? Portable<E>[]
  : T extends object
    ? { [K in keyof T as K extends 'sourceId' ? 'sourceKey' : K]: Portable<T[K]> }
    : T;

type Book = {
  importAlias?: string;
  id: string;
  name: string;
  abbreviation: string;
  edition?: string | null | undefined;
};
type PortableBook = Omit<Book, 'id'> & { key: string };

/** Only the portable boundary matches publication metadata to a target UUID. */
export function sourceImportIdentity(source: Omit<Book, 'id'>) {
  return JSON.stringify([
    canonicalLibraryKey(source.name),
    canonicalLibraryKey(source.abbreviation),
    canonicalLibraryKey(source.edition ?? ''),
  ]);
}

function mapReferences(
  value: unknown,
  field: string,
  target: string,
  resolve: (key: string) => string,
): unknown {
  if (Array.isArray(value))
    return value.map((entry) => mapReferences(entry, field, target, resolve));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key === field ? target : key,
      key === field
        ? entry == null
          ? entry
          : resolve(String(entry))
        : mapReferences(entry, field, target, resolve),
    ]),
  );
}

/** Reuse live validation, including nested rules, without accepting live IDs in YAML. */
export function portableLibraryEntry<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  return z.unknown().transform((value, ctx): Portable<T> => {
    const keys: string[] = [];
    const ids = new Map<string, string>();
    try {
      const live = mapReferences(value, 'sourceKey', 'sourceId', (raw) => {
        const key = z.string().trim().min(1).max(160).parse(raw);
        const found = ids.get(key);
        if (found) return found;
        const id = `00000000-0000-4000-8000-${String(keys.length + 1).padStart(12, '0')}`;
        keys.push(key);
        ids.set(key, id);
        return id;
      });
      // UUIDs from a campaign may never be smuggled into a portable document.
      const rejectIds = (entry: unknown): void => {
        if (Array.isArray(entry)) {
          entry.forEach(rejectIds);
          return;
        }
        if (entry && typeof entry === 'object') {
          if ('sourceId' in entry) throw new Error('Use sourceKey in YAML, not sourceId');
          Object.values(entry).forEach(rejectIds);
        }
      };
      rejectIds(value);
      const result = schema.safeParse(live);
      if (!result.success) {
        for (const issue of result.error.issues)
          ctx.addIssue({
            ...issue,
            path: issue.path.map((key) => (key === 'sourceId' ? 'sourceKey' : key)),
          });
        return z.NEVER;
      }
      return mapReferences(result.data, 'sourceId', 'sourceKey', (id) => {
        const key = keys[Number(id.slice(-12)) - 1];
        if (!key) throw new Error('Invalid portable source reference');
        return key;
      }) as Portable<T>;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid source reference',
      });
      return z.NEVER;
    }
  });
}

/** Keys are derived export labels, not stored identities. Include title to disambiguate abbreviations. */
export function sourceExportKey(book: Omit<Book, 'id'>): string {
  return canonicalLibraryKey(
    `${book.abbreviation}: ${book.name}${book.edition ? ` (${book.edition})` : ''}`,
  ).slice(0, 160);
}
export function sourceExportKeys(books: readonly Book[]): Map<string, string> {
  const keys = new Map<string, string>();
  const used = new Set<string>();
  for (const book of [...books].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = sourceExportKey(book);
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base.slice(0, 150)} #${suffix++}`;
    keys.set(book.id, key);
    used.add(key);
  }
  return keys;
}

/** Import aliases resolve against declared book metadata and the target campaign's UUIDs. */
export function importSourceReferences<T>(
  library: T & { sources?: readonly PortableBook[] | undefined },
  books: readonly Book[],
  importedAliases?: ReadonlyMap<string, string>,
): unknown {
  const assigned = new Set<string>();
  const exportKeys = sourceExportKeys(books);
  const aliases = new Map(
    [...sourceExportKeys(books)].map(([id, key]) => [canonicalLibraryKey(key), id]),
  );
  for (const book of books) {
    for (const label of [book.abbreviation, book.name]) {
      const key = canonicalLibraryKey(label);
      if (
        books.filter(
          (candidate) =>
            canonicalLibraryKey(candidate.abbreviation) === key ||
            canonicalLibraryKey(candidate.name) === key,
        ).length === 1
      )
        aliases.set(key, book.id);
    }
  }
  const sources = library.sources?.map(({ key, ...book }) => {
    const candidates = books.filter(
      (candidate) =>
        sourceImportIdentity(candidate) === sourceImportIdentity(book) &&
        !assigned.has(candidate.id),
    );
    const alias = canonicalLibraryKey(key);
    const id =
      importedAliases?.get(alias) ??
      candidates.find(
        (candidate) =>
          canonicalLibraryKey(candidate.importAlias ?? exportKeys.get(candidate.id) ?? '') ===
          alias,
      )?.id ??
      (candidates.length === 1 ? candidates[0]?.id : undefined);
    if (!id) throw new Error(`Sourcebook is unavailable: ${book.name}`);
    aliases.set(canonicalLibraryKey(key), id);
    assigned.add(id);
    return { ...book, id };
  });
  return {
    ...(mapReferences(library, 'sourceKey', 'sourceId', (key) => {
      const id = aliases.get(canonicalLibraryKey(key));
      if (!id) throw new Error(`Unknown YAML source ${key}; include its sourcebook record`);
      return id;
    }) as Record<string, unknown>),
    ...(sources === undefined ? {} : { sources }),
  };
}
export function exportSourceReferences<T>(library: T, books: readonly Book[]): Portable<T> {
  const keys = sourceExportKeys(books);
  return mapReferences(library, 'sourceId', 'sourceKey', (id) => {
    const key = keys.get(id);
    if (!key) throw new Error(`Sourcebook is unavailable: ${id}`);
    return key;
  }) as Portable<T>;
}

/** Preview books that will receive real database UUIDs during import. */
export function previewSourceBooks(
  incoming: readonly PortableBook[] | undefined,
  existing: readonly Book[],
): Book[] {
  const books = [...existing];
  const assigned = new Set<string>();
  const keys = sourceExportKeys(existing);
  for (const [index, { key, ...book }] of (incoming ?? []).entries()) {
    const candidates = existing.filter(
      (row) => sourceImportIdentity(row) === sourceImportIdentity(book) && !assigned.has(row.id),
    );
    const matched =
      candidates.find(
        (row) => canonicalLibraryKey(keys.get(row.id) ?? '') === canonicalLibraryKey(key),
      ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!matched && candidates.length > 1)
      throw new Error(`Ambiguous YAML sourcebook ${book.name}; use its exported source key`);
    if (matched) assigned.add(matched.id);
    else
      books.push({
        ...book,
        importAlias: key,
        id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
      });
  }
  return books;
}
