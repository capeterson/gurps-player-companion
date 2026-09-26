import { SKILL_ATTRIBUTES, SKILL_DIFFICULTIES } from '../../../../shared/constants/skills.ts';
import type { LibrarySkillCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibrarySkill } from '../../../db/dexie.ts';
import { effectPreview } from '../EffectsEditor.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { SkillForm } from '../SkillForm.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

const difficultyRank = (difficulty: string) =>
  (SKILL_DIFFICULTIES as readonly string[]).indexOf(difficulty);

function techLevelLabel(row: LocalLibrarySkill): string {
  if (row.techLevelPolicy?.kind === 'required') return '/TL';
  return row.techLevel != null ? `TL${row.techLevel}` : '';
}

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
  meta: (row) =>
    [`${row.attribute}/${row.difficulty}`, techLevelLabel(row)].filter(Boolean).join(' · '),
  detail: (row) => (
    <>
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.specializationPolicy.kind !== 'none' && (
        <p className="text-xs text-dim">
          Specialization ·{' '}
          {row.specializationPolicy.kind.startsWith('required') ? 'required' : 'optional'}
          {(row.specializationPolicy.kind === 'required_catalog' ||
            row.specializationPolicy.kind === 'optional_catalog') &&
            ` · ${row.specializationPolicy.options.map((option) => option.name).join(', ')}`}
        </p>
      )}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
      {row.prerequisites && <p className="text-xs text-dim">Prerequisites · {row.prerequisites}</p>}
      {row.prerequisiteRules && (
        <p className="text-xs text-warning">Structured prerequisite rules active</p>
      )}
      {row.defaults?.some((rule) => (rule.conditions?.length ?? 0) > 0) && (
        <p className="text-xs text-info">Includes conditional default candidates</p>
      )}
      {row.effects.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-base-content/70">
          {row.effects.map((effect, index) => (
            <li key={`${effect.target}-${index}`}>• {effectPreview(effect)}</li>
          ))}
        </ul>
      )}
    </>
  ),
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
