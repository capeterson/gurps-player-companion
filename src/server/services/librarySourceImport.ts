/** Sourcebook matching is a YAML concern; live CRUD always addresses UUIDs. */
import { eq } from 'drizzle-orm';
import { canonicalLibraryKey } from '../../shared/domain/libraryIdentity.ts';
import type { LibraryYamlDoc } from '../../shared/schemas/campaignLibrary.ts';
import { librarySourceCreate } from '../../shared/schemas/libraryMetadata.ts';
import { sourceExportKeys, sourceImportIdentity } from '../../shared/yaml/sourceReferences.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { campaignLibrarySources } from '../db/schema.ts';

export async function importSourcebooks(
  tx: AuditTx,
  campaignId: string,
  incoming: LibraryYamlDoc['library']['sources'],
) {
  const books = await tx
    .select()
    .from(campaignLibrarySources)
    .where(eq(campaignLibrarySources.campaignId, campaignId));
  const existingExportKeys = sourceExportKeys(books);
  const assigned = new Set<string>();
  const aliases = new Map<string, string>();
  const counts = { created: 0, updated: 0, deleted: 0 };
  for (const { key, ...source } of incoming ?? []) {
    const body = librarySourceCreate.parse(source);
    const candidates = books.filter(
      (book) => sourceImportIdentity(book) === sourceImportIdentity(body) && !assigned.has(book.id),
    );
    const matched =
      candidates.find(
        (book) =>
          canonicalLibraryKey(existingExportKeys.get(book.id) ?? '') === canonicalLibraryKey(key),
      ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!matched && candidates.length > 1)
      throw new Error(`Ambiguous YAML sourcebook ${source.name}; use its exported source key`);
    const values = {
      ...body,
      edition: body.edition ?? null,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    };
    const [saved] = matched
      ? await tx
          .update(campaignLibrarySources)
          .set(values)
          .where(eq(campaignLibrarySources.id, matched.id))
          .returning()
      : await tx
          .insert(campaignLibrarySources)
          .values({ ...values, campaignId })
          .returning();
    if (!saved) throw new Error('Could not import sourcebook');
    aliases.set(canonicalLibraryKey(key), saved.id);
    assigned.add(saved.id);
    counts[matched ? 'updated' : 'created']++;
  }
  return { counts, aliases, assigned };
}
