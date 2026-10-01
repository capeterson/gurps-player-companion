import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../../../../shared/constants/skills.ts';
import type { LibrarySkillCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import type { LocalLibrarySkill } from '../../../db/dexie.ts';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { LibrarySkillDetails, librarySkillMeta } from '../LibrarySkillDetails.tsx';
import { SkillForm } from '../SkillForm.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

const difficultyRank = (difficulty: string) =>
  (SKILL_DIFFICULTIES as readonly string[]).indexOf(difficulty);

export const skillsConfig: LibrarySectionConfig<LocalLibrarySkill> = {
  key: 'skills',
  entityClass: 'campaign_library_skill',
  noun: 'skill',
  plural: 'skills',
  columns: [
    {
      sort: 'difficulty',
      label: 'Difficulty',
      shortLabel: 'Diff',
      className: 'w-16 text-right sm:w-24',
      compare: (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty),
      cell: (row) => `${row.attribute}/${row.difficulty}`,
    },
  ],
  group: (row) => row.attribute,
  groupOrder: SKILL_ATTRIBUTES,
  meta: librarySkillMeta,
  detail: (row) => <LibrarySkillDetails skill={row} />,
  deleteTitle: 'Delete library skill',
  deleteNote: 'Existing characters that use this skill are not affected.',
};

export function SkillsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibrarySkillCreate>(shell.campaignId, 'skills');
  return (
    <CrudLibrarySection
      shell={shell}
      config={skillsConfig}
      entries={shell.library.skills}
      crud={crud}
      renderForm={(row) => (
        <SkillForm
          key={row?.id ?? 'new'}
          campaignId={shell.campaignId}
          {...(row ? { initial: row } : {})}
          isPending={row ? crud.update.isPending : crud.create.isPending}
          error={(row ? crud.update.error : crud.create.error)?.message ?? null}
          onSubmit={(body) =>
            row ? crud.update.mutate({ id: row.id, body }) : crud.create.mutate(body)
          }
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
          libraryItems={shell.library.items}
        />
      )}
    />
  );
}
