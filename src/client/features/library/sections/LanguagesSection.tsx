import type { LibraryLanguageCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibraryLanguage } from '../../../db/dexie.ts';
import { LanguageForm } from '../LibraryPackagesForms.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

export const languagesConfig: LibrarySectionConfig<LocalLibraryLanguage> = {
  key: 'languages',
  entityClass: 'campaign_library_language',
  noun: 'language',
  plural: 'languages',
  columns: [
    {
      sort: 'kind',
      label: 'Form',
      className: 'w-24',
      compare: (a, b) => Number(a.isSignLanguage) - Number(b.isSignLanguage),
      cell: (row) => (row.isSignLanguage ? 'Sign' : 'Spoken'),
    },
  ],
  group: (row) => (row.isSignLanguage ? 'Sign languages' : 'Spoken languages'),
  groupOrder: ['Spoken languages', 'Sign languages'],
  meta: (row) => (row.isSignLanguage ? 'Sign language' : 'Spoken language'),
  detail: (row) => (
    <>
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
  ),
  deleteTitle: 'Delete library language',
  deleteNote: 'Existing characters that know this language are not affected.',
};

export function LanguagesSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryLanguageCreate>(shell.campaignId, 'languages');
  return (
    <CrudLibrarySection
      shell={shell}
      config={languagesConfig}
      entries={shell.library.languages}
      crud={crud}
      renderForm={(row) => (
        <LanguageForm
          key={row?.id ?? 'new'}
          {...(row ? { initial: row } : {})}
          isPending={row ? crud.update.isPending : crud.create.isPending}
          error={(row ? crud.update.error : crud.create.error)?.message ?? null}
          onSubmit={(body) =>
            row ? crud.update.mutate({ id: row.id, body }) : crud.create.mutate(body)
          }
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
        />
      )}
    />
  );
}
