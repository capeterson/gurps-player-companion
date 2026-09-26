import type { ActiveEffectDefinition } from '../../../../shared/schemas/activeEffects.ts';
import type { LocalLibraryActiveEffect } from '../../../db/dexie.ts';
import { compareTableText } from '../../characters/sections/useSortableCharacterRows.tsx';
import { ActiveEffectForm } from '../ActiveEffectForm.tsx';
import { effectPreview } from '../EffectsEditor.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

export const UNTAGGED = 'Untagged';

function durationLabel(row: LocalLibraryActiveEffect): string {
  return row.duration.kind === 'indefinite'
    ? 'Indefinite'
    : `${row.duration.amount} ${row.duration.kind}`;
}

export const activeEffectsConfig: LibrarySectionConfig<LocalLibraryActiveEffect> = {
  key: 'activeEffects',
  entityClass: 'campaign_library_active_effect',
  noun: 'active effect',
  plural: 'active effects',
  columns: [
    {
      sort: 'duration',
      label: 'Duration',
      className: 'sm:w-32',
      hideOnMobile: true,
      compare: (a, b) => compareTableText(durationLabel(a), durationLabel(b)),
      cell: durationLabel,
    },
  ],
  group: (row) => row.tags[0]?.trim() || UNTAGGED,
  meta: (row) => [durationLabel(row), row.stacking.kind].join(' · '),
  detail: (row) => (
    <>
      {row.description && <p className="text-sm text-muted">{row.description}</p>}
      {(row.effects.length > 0 || row.capabilities.length > 0) && (
        <p className="text-xs text-base-content/70">
          {[...row.effects.map(effectPreview), ...row.capabilities.map((c) => c.label)].join('; ')}
        </p>
      )}
      {row.tags.length > 1 && <p className="text-xs text-dim">Tags · {row.tags.join(', ')}</p>}
      {row.source && <p className="text-xs text-dim">Source · {row.source}</p>}
    </>
  ),
  deleteTitle: 'Delete active effect definition',
  deleteNote: 'Character instances keep their owned mechanics.',
};

export function ActiveEffectsSection(shell: LibrarySectionShellProps) {
  const crud = useLibraryEntryMutations<ActiveEffectDefinition>(shell.campaignId, 'activeEffects');
  return (
    <CrudLibrarySection
      shell={shell}
      config={activeEffectsConfig}
      entries={shell.library.activeEffects}
      crud={crud}
      renderForm={(row) => (
        <ActiveEffectForm
          key={row?.id ?? 'new'}
          campaignId={shell.campaignId}
          {...(row ? { initial: row } : {})}
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
          onSave={async (value) => {
            if (row) {
              await crud.updateAsync(row.id, value);
              crud.setEditId(null);
            } else {
              await crud.createAsync(value);
              crud.setAddOpen(false);
            }
          }}
        />
      )}
    />
  );
}
