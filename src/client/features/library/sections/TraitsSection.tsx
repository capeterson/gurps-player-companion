import { TRAIT_KINDS } from '../../../../shared/constants/traits.ts';
import { formatSigned } from '../../../../shared/format/number.ts';
import type { LibraryTraitCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../../components/markdown/Markdown.tsx';
import type { LocalLibraryTrait } from '../../../db/dexie.ts';
import { compareOptionalLevel } from '../../characters/sections/useSortableCharacterRows.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { MechanicalEffectList } from '../MechanicalEffectList.tsx';
import { TraitForm } from '../TraitForm.tsx';
import { pricingDisplayValue } from '../pricingDisplay.ts';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

function kindLabel(kind: string): string {
  const label = kind.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function signed(value: number, unit: string): string {
  return `${formatSigned(value, { zero: 'plain' })}${unit}`;
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
      compare: (a, b) =>
        compareOptionalLevel(
          pricingDisplayValue(a.calculation, 'points', a.basePoints),
          pricingDisplayValue(b.calculation, 'points', b.basePoints),
        ),
      cell: (row) => pricingDisplayValue(row.calculation, 'points', row.basePoints) ?? 'Calculated',
    },
  ],
  group: (row) => kindLabel(row.kind),
  groupOrder: TRAIT_KINDS.map(kindLabel),
  meta: (row) =>
    `${kindLabel(row.kind)} · ${pricingDisplayValue(row.calculation, 'points', row.basePoints) ?? 'Calculated'} pt${!row.calculation && row.pointsPerLevel ? ` + ${row.pointsPerLevel}/level` : ''}`,
  detail: (row) => (
    <>
      {row.description && <Markdown source={row.description} className="text-sm text-muted" />}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
      {row.availableModifiers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.availableModifiers.map((m) => (
            <span key={`${m.name}-${m.costValue}`} className="chip text-xs">
              {m.name}{' '}
              {pricingDisplayValue(m.calculation, 'modifier', m.costValue) == null
                ? 'Calculated'
                : signed(
                    pricingDisplayValue(m.calculation, 'modifier', m.costValue) ?? 0,
                    m.costType === 'percent' ? '%' : ' pts',
                  )}
            </span>
          ))}
        </div>
      )}
      <MechanicalEffectList effects={row.effects} campaignId={row.campaignId} />
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
