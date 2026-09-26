import type { LibraryEnchantmentCreate } from '../../../../shared/schemas/campaignLibrary.ts';
import type { LocalLibraryEnchantment } from '../../../db/dexie.ts';
import { compareTableText } from '../../characters/sections/useSortableCharacterRows.tsx';
import { EnchantmentForm } from '../EnchantmentForm.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

const APPLICABILITY_LABELS: Record<string, string> = {
  weapon: 'Weapons',
  armor: 'Armor',
  shield: 'Shields',
  any: 'Any item',
};

function stackingLabel(row: LocalLibraryEnchantment): string {
  return row.stackingPolicy.kind === 'highest'
    ? `highest (${row.stackingPolicy.key})`
    : row.stackingPolicy.kind;
}

export const enchantmentsConfig: LibrarySectionConfig<LocalLibraryEnchantment> = {
  key: 'enchantments',
  entityClass: 'campaign_library_enchantment',
  noun: 'enchantment',
  plural: 'enchantments',
  columns: [
    {
      sort: 'stacking',
      label: 'Stacking',
      className: 'sm:w-32',
      hideOnMobile: true,
      compare: (a, b) => compareTableText(stackingLabel(a), stackingLabel(b)),
      cell: stackingLabel,
    },
  ],
  group: (row) => APPLICABILITY_LABELS[row.applicability] ?? row.applicability,
  groupOrder: Object.values(APPLICABILITY_LABELS),
  meta: (row) => `${row.applicability} · ${stackingLabel(row)}`,
  detail: (row) => (
    <>
      {row.description && <p className="text-sm text-muted">{row.description}</p>}
      {row.effects.length > 0 && (
        <p className="text-xs text-base-content/70">
          {row.effects
            .map((effect) => `${effect.target} ${effect.value >= 0 ? '+' : ''}${effect.value}`)
            .join(' · ')}
        </p>
      )}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
  ),
  deleteTitle: 'Delete enchantment definition',
  deleteNote: 'Existing item snapshots keep their mechanics and become detached.',
};

export function EnchantmentsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<LibraryEnchantmentCreate>(shell.campaignId, 'enchantments');
  return (
    <CrudLibrarySection
      shell={shell}
      config={enchantmentsConfig}
      entries={shell.library.enchantments}
      crud={crud}
      renderForm={(row) => (
        <EnchantmentForm
          key={row?.id ?? 'new'}
          campaignId={shell.campaignId}
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
