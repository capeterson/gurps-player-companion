import type { LibraryStyleCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibraryStyle } from '../../../db/dexie.ts';
import { StyleForm } from '../LibraryPackagesForms.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

export const stylesConfig: LibrarySectionConfig<LocalLibraryStyle> = {
  key: 'styles',
  entityClass: 'campaign_library_style',
  noun: 'style',
  plural: 'styles',
  columns: [
    {
      sort: 'techniqueCount',
      label: 'Techniques',
      className: 'w-20 text-right sm:w-24',
      compare: (a, b) => a.techniques.length - b.techniques.length,
      cell: (row) => row.techniques.length,
    },
  ],
  group: (row) => row.skills[0] ?? 'Unspecified skill',
  meta: (row) =>
    `${row.skills.length} skill${row.skills.length === 1 ? '' : 's'} · ${row.techniques.length} technique${row.techniques.length === 1 ? '' : 's'} · ${row.perks.length} perk${row.perks.length === 1 ? '' : 's'}`,
  detail: (row) => (
    <div className="space-y-2">
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.skills.length > 0 && (
        <p className="text-xs text-dim">Skills · {row.skills.join(', ')}</p>
      )}
      {row.perks.length > 0 && <p className="text-xs text-dim">Perks · {row.perks.join(', ')}</p>}
      {row.techniques.length > 0 && (
        <ul className="list-inside list-disc text-xs text-dim">
          {row.techniques.map((technique, index) => (
            <li key={`${technique.name}-${index}`}>
              {technique.name} ({technique.defaultSkillName}, {technique.difficulty})
            </li>
          ))}
        </ul>
      )}
    </div>
  ),
  deleteTitle: 'Delete library style',
  deleteNote: 'Existing character skills and techniques are not affected.',
};

export function StylesSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryStyleCreate>(shell.campaignId, 'styles');
  return (
    <CrudLibrarySection
      shell={shell}
      config={stylesConfig}
      entries={shell.library.styles}
      crud={crud}
      renderForm={(row) => (
        <StyleForm
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
