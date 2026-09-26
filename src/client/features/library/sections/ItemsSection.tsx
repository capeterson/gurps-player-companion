import type { LibraryItemCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import type { LocalLibraryItem } from '../../../db/dexie.ts';
import { compareOptionalLevel } from '../../characters/sections/useSortableCharacterRows.tsx';
import { ItemForm } from '../ItemForm.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
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
      compare: (a, b) => compareOptionalLevel(Number(a.weightLbs), Number(b.weightLbs)),
      cell: (row) => `${row.weightLbs} lb`,
    },
    {
      sort: 'cost',
      label: 'Cost',
      className: 'text-right sm:w-24',
      hideOnMobile: true,
      compare: (a, b) => compareOptionalLevel(Number(a.cost), Number(b.cost)),
      cell: (row) => `$${row.cost}`,
    },
  ],
  group: (row) => categoryLabel(row.category),
  meta: (row) => `${categoryLabel(row.category)} · ${row.weightLbs} lb · $${row.cost}`,
  detail: (row) => (
    <>
      {row.description && <p className="text-sm text-muted">{row.description}</p>}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
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
