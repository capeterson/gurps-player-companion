import { SPELL_DIFFICULTIES } from '../../../../shared/constants/skills.ts';
import type { LibrarySpellCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibrarySpell } from '../../../db/dexie.ts';
import { compareOptionalLevel } from '../../characters/sections/useSortableCharacterRows.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { SpellForm } from '../SpellForm.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

export const NO_COLLEGE = 'No college';

const difficultyRank = (difficulty: string) =>
  (SPELL_DIFFICULTIES as readonly string[]).indexOf(difficulty);

export const spellsConfig: LibrarySectionConfig<LocalLibrarySpell> = {
  key: 'spells',
  entityClass: 'campaign_library_spell',
  noun: 'spell',
  plural: 'spells',
  columns: [
    {
      sort: 'difficulty',
      label: 'Difficulty',
      shortLabel: 'Diff',
      className: 'sm:w-20',
      hideOnMobile: true,
      compare: (a, b) => difficultyRank(a.difficulty) - difficultyRank(b.difficulty),
      cell: (row) => `IQ/${row.difficulty}`,
    },
    {
      sort: 'energy',
      label: 'Cost',
      className: 'w-16 text-right sm:w-20',
      compare: (a, b) => compareOptionalLevel(a.baseEnergyCost, b.baseEnergyCost),
      cell: (row) => `${row.baseEnergyCost} FP`,
    },
  ],
  group: (row) => row.college?.trim() || NO_COLLEGE,
  meta: (row) =>
    [
      `IQ/${row.difficulty}`,
      `${row.baseEnergyCost} FP`,
      row.maintenanceCost != null ? `upkeep ${row.maintenanceCost}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  detail: (row) => (
    <>
      {(row.castingTime || row.duration) && (
        <p className="text-xs text-dim">
          {row.castingTime ? `Cast in ${row.castingTime}` : ''}
          {row.castingTime && row.duration ? ' · ' : ''}
          {row.duration ? `Lasts ${row.duration}` : ''}
        </p>
      )}
      {row.prerequisites && <p className="text-xs text-dim">Prerequisites · {row.prerequisites}</p>}
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
  ),
  deleteTitle: 'Delete library spell',
  deleteNote: 'Existing characters that know this spell are not affected.',
};

export function SpellsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibrarySpellCreate>(shell.campaignId, 'spells');
  return (
    <CrudLibrarySection
      shell={shell}
      config={spellsConfig}
      entries={shell.library.spells}
      crud={crud}
      renderForm={(row) => (
        <SpellForm
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
