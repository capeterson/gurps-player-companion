import type { LibraryTechniqueCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { TECHNIQUE_DIFFICULTIES } from '../../../../shared/schemas/technique.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibraryTechnique } from '../../../db/dexie.ts';
import { compareTableText } from '../../characters/sections/useSortableCharacterRows.tsx';
import { TechniqueForm } from '../LibraryPackagesForms.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

function defaultLine(row: LocalLibraryTechnique): string {
  return row.defaultModifier === 0
    ? `${row.defaultSkillName} (full skill)`
    : `${row.defaultSkillName}${row.defaultModifier}`;
}

function techniqueMeta(row: LocalLibraryTechnique): string {
  return [
    defaultLine(row),
    row.difficulty === 'A' ? 'Average' : 'Hard',
    row.maxLevel != null ? `cap +${row.maxLevel} above default` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const techniquesConfig: LibrarySectionConfig<LocalLibraryTechnique> = {
  key: 'techniques',
  entityClass: 'campaign_library_technique',
  noun: 'technique',
  plural: 'techniques',
  columns: [
    {
      sort: 'difficulty',
      label: 'Difficulty',
      shortLabel: 'Diff',
      className: 'w-20 text-right sm:w-24',
      compare: (a, b) =>
        TECHNIQUE_DIFFICULTIES.indexOf(a.difficulty) - TECHNIQUE_DIFFICULTIES.indexOf(b.difficulty),
      cell: (row) => (row.difficulty === 'A' ? 'Average' : 'Hard'),
    },
  ],
  group: (row) => row.defaultSkillName,
  meta: techniqueMeta,
  detail: (row) => (
    <>
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.prereq && <p className="text-xs text-dim">Prerequisites · {row.prereq}</p>}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
  ),
  deleteTitle: 'Delete library technique',
  deleteNote: 'Existing character techniques are not affected.',
};

export function TechniquesSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryTechniqueCreate>(shell.campaignId, 'techniques');
  return (
    <CrudLibrarySection
      shell={shell}
      config={techniquesConfig}
      entries={shell.library.techniques}
      crud={crud}
      renderForm={(row) => (
        <TechniqueForm
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
