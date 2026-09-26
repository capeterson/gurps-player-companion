import { TRAIT_KINDS } from '../../../../shared/constants/traits.ts';
import type { LibraryTraitCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibraryTrait } from '../../../db/dexie.ts';
import { compareOptionalLevel } from '../../characters/sections/useSortableCharacterRows.tsx';
import { effectPreview } from '../EffectsEditor.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { TraitForm } from '../TraitForm.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

function kindLabel(kind: string): string {
  const label = kind.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function signed(value: number, unit: string): string {
  return `${value > 0 ? '+' : ''}${value}${unit}`;
}

export const traitsConfig: LibrarySectionConfig<LocalLibraryTrait> = {
  key: 'traits',
  entityClass: 'campaign_library_trait',
  noun: 'trait',
  plural: 'traits',
  columns: [
    {
      sort: 'points',
      label: 'Points',
      shortLabel: 'Pts',
      className: 'w-14 text-right sm:w-16',
      compare: (a, b) => compareOptionalLevel(a.basePoints, b.basePoints),
      cell: (row) => row.basePoints,
    },
  ],
  group: (row) => kindLabel(row.kind),
  groupOrder: TRAIT_KINDS.map(kindLabel),
  meta: (row) =>
    `${kindLabel(row.kind)} · ${row.basePoints} pt${row.pointsPerLevel ? ` + ${row.pointsPerLevel}/level` : ''}`,
  detail: (row) => (
    <>
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
      {row.availableModifiers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.availableModifiers.map((m) => (
            <span key={`${m.name}-${m.costValue}`} className="chip text-xs">
              {m.name}{' '}
              {m.costType === 'percent' ? signed(m.costValue, '%') : signed(m.costValue, ' pts')}
            </span>
          ))}
        </div>
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
  deleteTitle: 'Delete library trait',
  deleteNote: 'Existing characters that use this trait are not affected.',
};

export function TraitsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryTraitCreate>(shell.campaignId, 'traits');
  return (
    <CrudLibrarySection
      shell={shell}
      config={traitsConfig}
      entries={shell.library.traits}
      crud={crud}
      renderForm={(row) => (
        <TraitForm
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
