import type { LibraryItemCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import type { LocalLibraryItem } from '../../../db/dexie.ts';
import { compareOptionalLevel } from '../../characters/sections/useSortableCharacterRows.tsx';
import { ItemForm } from '../ItemForm.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { pricingDisplayValue } from '../pricingDisplay.ts';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

function categoryLabel(category: string): string {
  const label = category.trim() || 'general';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const itemsConfig: LibrarySectionConfig<LocalLibraryItem> = {
  key: 'items',
  entityClass: 'campaign_library_item',
  noun: 'item',
  plural: 'items',
  columns: [
    {
      sort: 'weight',
      label: 'Weight',
      shortLabel: 'Lb',
      className: 'w-16 text-right sm:w-20',
      compare: (a, b) =>
        compareOptionalLevel(
          pricingDisplayValue(a.calculation, 'weightLbs', Number(a.weightLbs)),
          pricingDisplayValue(b.calculation, 'weightLbs', Number(b.weightLbs)),
        ),
      cell: (row) =>
        `${pricingDisplayValue(row.calculation, 'weightLbs', Number(row.weightLbs)) ?? 'Calculated'} lb`,
    },
    {
      sort: 'cost',
      label: 'Cost',
      className: 'text-right sm:w-24',
      hideOnMobile: true,
      compare: (a, b) =>
        compareOptionalLevel(
          pricingDisplayValue(a.calculation, 'cost', Number(a.cost)),
          pricingDisplayValue(b.calculation, 'cost', Number(b.cost)),
        ),
      cell: (row) =>
        pricingDisplayValue(row.calculation, 'cost', Number(row.cost)) == null
          ? 'Calculated'
          : `${pricingDisplayValue(row.calculation, 'cost', Number(row.cost))}`,
    },
  ],
  group: (row) => categoryLabel(row.category),
  meta: (row) =>
    `${categoryLabel(row.category)} · ${pricingDisplayValue(row.calculation, 'weightLbs', Number(row.weightLbs)) ?? 'Calculated'} lb · ${pricingDisplayValue(row.calculation, 'cost', Number(row.cost)) == null ? 'Calculated cost' : `${pricingDisplayValue(row.calculation, 'cost', Number(row.cost))}`}`,
  detail: (row) => (
    <>{row.description && <p className="text-sm text-muted">{row.description}</p>}</>
  ),
  deleteTitle: 'Delete library item',
  deleteNote: 'Existing characters that have this item are not affected.',
};

export function ItemsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryItemCreate>(shell.campaignId, 'items');
  return (
    <CrudLibrarySection
      shell={shell}
      config={itemsConfig}
      entries={shell.library.items}
      crud={crud}
      renderForm={(row) => (
        <ItemForm
          key={row?.id ?? 'new'}
          {...(row ? { initial: row } : {})}
          isPending={row ? crud.update.isPending : crud.create.isPending}
          error={(row ? crud.update.error : crud.create.error)?.message ?? null}
          onSubmit={(body) =>
            row ? crud.update.mutate({ id: row.id, body }) : crud.create.mutate(body)
          }
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
          definitions={shell.library.enchantments}
        />
      )}
    />
  );
}
