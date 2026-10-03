import { useMemo } from 'react';
import type {
  LibraryModifierCreate,
  LibrarySourceCreate,
} from '../../../../shared/schemas/libraryMetadata.ts';
import type { LocalLibraryModifier, LocalLibrarySource } from '../../../db/dexie.ts';
import { LibraryEntryEditor } from '../LibraryEntryEditor.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';
function CatalogForm({
  section,
  initial,
  onSubmit,
  onCancel,
  error,
  pending,
}: {
  section: 'sources' | 'modifiers';
  initial: LocalLibrarySource | LocalLibraryModifier | null;
  onSubmit: (body: LibrarySourceCreate | LibraryModifierCreate) => void;
  onCancel: () => void;
  error: string | undefined;
  pending: boolean;
}) {
  return (
    <LibraryEntryEditor<LibrarySourceCreate | LibraryModifierCreate>
      section={section}
      initial={initial ?? undefined}
      onSubmit={onSubmit}
      onCancel={onCancel}
      error={error}
      isPending={pending}
    />
  );
}
export function CatalogSection({
  section,
  ...shell
}: LibrarySectionShellProps & { section: 'sources' | 'modifiers' }) {
  const crud = useLibraryEntryMutations<LibrarySourceCreate | LibraryModifierCreate>(
    shell.campaignId,
    section,
  );
  const noun = section === 'sources' ? 'source' : 'modifier';
  const entryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, entries] of Object.entries(shell.library)) {
      if (key === 'sources') continue;
      for (const entry of entries) {
        if ('sourceId' in entry && entry.sourceId) {
          counts.set(entry.sourceId, (counts.get(entry.sourceId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [shell.library]);
  const config: LibrarySectionConfig<LocalLibrarySource | LocalLibraryModifier> = {
    key: section,
    entityClass: section === 'sources' ? 'campaign_library_source' : 'campaign_library_modifier',
    noun,
    plural: section,
    columns:
      section === 'sources'
        ? [
            {
              sort: 'entryCount',
              label: 'Entries',
              className: 'w-16 text-right sm:w-20',
              compare: (a, b) => (entryCounts.get(a.id) ?? 0) - (entryCounts.get(b.id) ?? 0),
              cell: (row) => entryCounts.get(row.id) ?? 0,
            },
          ]
        : [],
    group: section === 'sources' ? null : (row) => ('category' in row ? row.category : ''),
    meta: (row) =>
      'priority' in row ? `${row.abbreviation} · Priority ${row.priority}` : row.category,
    detail: (row) => (
      <p className="whitespace-pre-wrap break-words">
        {'notes' in row ? row.notes : 'description' in row ? row.description : ''}
      </p>
    ),
    deleteTitle: `Delete library ${noun}`,
    deleteNote: 'Existing character costs remain unchanged.',
  };
  return (
    <CrudLibrarySection
      shell={shell}
      config={config}
      entries={shell.library[section]}
      crud={crud}
      renderForm={(row) => (
        <CatalogForm
          key={row?.id ?? 'new'}
          section={section}
          initial={row}
          pending={row ? crud.update.isPending : crud.create.isPending}
          error={(row ? crud.update.error : crud.create.error)?.message}
          onSubmit={(body) =>
            row ? crud.update.mutate({ id: row.id, body }) : crud.create.mutate(body)
          }
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
        />
      )}
    />
  );
}
