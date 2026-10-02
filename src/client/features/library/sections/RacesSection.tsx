import type { LibraryRaceCreate } from '../../../../shared/schemas/race.ts';
import type { LocalLibraryRace } from '../../../db/dexie.ts';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { RaceForm } from '../RaceForm.tsx';
import { RaceSummary } from '../RaceSummary.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

export const racesConfig: LibrarySectionConfig<LocalLibraryRace> = {
  key: 'races',
  entityClass: 'campaign_library_race',
  noun: 'race',
  plural: 'races',
  columns: [
    {
      sort: 'points',
      label: 'Points',
      className: 'w-20',
      compare: (a, b) => a.points - b.points,
      cell: (row) => row.points,
    },
  ],
  group: (row) => (row.kind === 'lens' ? 'Lenses' : 'Races'),
  groupOrder: ['Races', 'Lenses'],
  meta: (row) => `${row.kind === 'lens' ? 'Lens' : 'Race'} · ${row.points} points`,
  detail: (row) => (
    <>
      <RaceSummary
        race={{
          selection: { raceId: row.id, variantKey: null, lensIds: [], formKey: null },
          snapshot: { ...row, description: row.description ?? null, sources: [] },
        }}
      />
      {row.variants.length > 0 && <p>Variants: {row.variants.map((v) => v.name).join(', ')}</p>}
      {row.forms.length > 0 && <p>Forms: {row.forms.map((v) => v.name).join(', ')}</p>}
    </>
  ),
  deleteTitle: 'Delete library race',
  deleteNote: 'Characters retain their owned race and its effects.',
};
export function RacesSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryRaceCreate>(shell.campaignId, 'races');
  return (
    <CrudLibrarySection
      shell={shell}
      config={racesConfig}
      entries={shell.library.races}
      crud={crud}
      renderForm={(row) => (
        <RaceForm
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
