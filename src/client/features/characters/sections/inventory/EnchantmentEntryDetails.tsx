import { useState } from 'react';
import type { LibraryEnchantmentOut } from '../../../../../shared/schemas/campaignLibrary.ts';
import type {
  EnchantmentRef,
  InventoryItemOut,
  InventoryItemUpdate,
} from '../../../../../shared/schemas/inventory.ts';
import {
  EnchantmentMechanicsForm,
  type MechanicsDraft,
  mechanicsDraft,
  parseMechanicsDraft,
} from './EnchantmentMechanicsForm.tsx';
import { enchantmentUpdatePreview, mechanicsLines, updatedEntry } from './enchantmentText.ts';
import { mutateItem } from './itemMutations.ts';
import { useItemAction } from './useItemAction.ts';

/** An open effects form, held by the list so a re-keyed row keeps its draft. */
export interface MechanicsDraftState {
  index: number;
  spellName: string;
  draft: MechanicsDraft;
}

/** Replace one entry, provided it is still the one the user was looking at. */
function replaceEntry(
  current: InventoryItemOut,
  index: number,
  matches: (entry: EnchantmentRef) => boolean,
  next: (entry: EnchantmentRef) => EnchantmentRef,
): InventoryItemUpdate {
  const entry = current.enchantments[index];
  if (!entry || !matches(entry))
    throw new Error('This enchantment changed; review it again before saving');
  return {
    enchantments: current.enchantments.map((row, i) => (i === index ? next(row) : row)),
  };
}

function MechanicsSummary({ entry }: { entry: EnchantmentRef }) {
  const lines = mechanicsLines(entry.mechanics);
  if (lines.length === 0) return <p className="text-sm text-base-content/60">No effects.</p>;
  return (
    <ul aria-label={`Effects of ${entry.spellName}`} className="space-y-0.5 text-sm break-words">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Effects of one enchantment. Linked entries follow their campaign
 * definition (the server rehydrates them on every write), so their effects
 * are read-only until **Make independent**; independent entries edit their
 * own complete effects in one validated form.
 */
export function EnchantmentEntryDetails({
  item,
  index,
  entry,
  definition,
  draftState,
  onDraftState,
  campaignId,
  skillNames,
}: {
  item: InventoryItemOut;
  index: number;
  entry: EnchantmentRef;
  definition: LibraryEnchantmentOut | undefined;
  draftState: MechanicsDraftState | null;
  onDraftState: (state: MechanicsDraftState | null) => void;
  campaignId?: string | null | undefined;
  skillNames: readonly string[];
}) {
  const { run, pending } = useItemAction(item);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const linked = !!entry.definitionId;
  const preview = linked ? enchantmentUpdatePreview(entry, definition) : null;
  const editing = !linked && draftState?.index === index ? draftState : null;

  if (linked)
    return (
      <div className="min-w-0 space-y-3">
        <MechanicsSummary entry={entry} />
        {preview && definition && (
          <div className="min-w-0 space-y-2 rounded-lg border border-info/40 bg-info/5 p-3">
            <p className="text-sm break-words">
              {definition.name} changed in the campaign library.
            </p>
            {reviewing ? (
              <>
                {preview.notes.length > 0 && (
                  <ul className="text-sm break-words">
                    {preview.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {preview.removed.length > 0 && (
                  <div>
                    <p className="label-eyebrow">Removes</p>
                    <ul aria-label="Removed effects" className="text-sm break-words">
                      {preview.removed.map((line) => (
                        <li key={line} className="line-through text-base-content/70">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.added.length > 0 && (
                  <div>
                    <p className="label-eyebrow">Adds</p>
                    <ul aria-label="Added effects" className="text-sm break-words">
                      {preview.added.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={pending}
                    onClick={() =>
                      void run(
                        `update ${entry.spellName}`,
                        () =>
                          mutateItem(item.id, `Update ${entry.spellName}`, (current) =>
                            replaceEntry(
                              current,
                              index,
                              (row) => row.definitionId === entry.definitionId,
                              (row) => updatedEntry(row, definition),
                            ),
                          ),
                        () => setReviewing(false),
                      )
                    }
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReviewing(false)}
                  >
                    Not now
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setReviewing(true)}>
                Review update
              </button>
            )}
          </div>
        )}
        {confirmDetach ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-sm break-words">
              Stop following {entry.spellName} in the campaign library? Its current effects stay and
              become editable here.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => setConfirmDetach(false)}>
              Keep linked
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() =>
                void run(
                  `make ${entry.spellName} independent`,
                  () =>
                    mutateItem(item.id, `Make ${entry.spellName} independent`, (current) =>
                      replaceEntry(
                        current,
                        index,
                        (row) => row.definitionId === entry.definitionId,
                        (row) => ({
                          ...row,
                          definitionId: null,
                          definitionRevision: null,
                          definitionSource: null,
                        }),
                      ),
                    ),
                  () => {
                    setConfirmDetach(false);
                    onDraftState({
                      index,
                      spellName: entry.spellName,
                      draft: mechanicsDraft(entry.mechanics),
                    });
                  },
                )
              }
            >
              Make independent
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Make ${entry.spellName} independent`}
            onClick={() => setConfirmDetach(true)}
          >
            Make independent
          </button>
        )}
      </div>
    );

  if (!editing)
    return (
      <div className="min-w-0 space-y-2">
        <MechanicsSummary entry={entry} />
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`Edit effects of ${entry.spellName}`}
          onClick={() => {
            setErrors({});
            onDraftState({
              index,
              spellName: entry.spellName,
              draft: mechanicsDraft(entry.mechanics),
            });
          }}
        >
          Edit effects
        </button>
      </div>
    );

  return (
    <EnchantmentMechanicsForm
      spellName={entry.spellName}
      draft={editing.draft}
      errors={errors}
      pending={pending}
      campaignId={campaignId}
      skillNames={skillNames}
      onChange={(draft) => {
        onDraftState({ ...editing, draft });
        if (Object.keys(errors).length > 0) {
          const result = parseMechanicsDraft(draft);
          setErrors(result.ok ? {} : result.errors);
        }
      }}
      onCancel={() => {
        setErrors({});
        onDraftState(null);
      }}
      onSave={() => {
        const result = parseMechanicsDraft(editing.draft);
        if (!result.ok) {
          setErrors(result.errors);
          return;
        }
        setErrors({});
        const empty = result.mechanics.effects.length === 0 && result.mechanics.levels.length === 0;
        void run(
          `save effects of ${entry.spellName}`,
          () =>
            mutateItem(item.id, `${entry.spellName} effects`, (current) =>
              replaceEntry(
                current,
                index,
                (row) =>
                  !row.definitionId &&
                  (row.spellName === editing.spellName || row.spellName === entry.spellName),
                (row) => ({
                  ...row,
                  // A note-only entry stays note-only when nothing was added.
                  mechanics: empty && row.mechanics == null ? row.mechanics : result.mechanics,
                }),
              ),
            ),
          () => onDraftState(null),
        );
      }}
    />
  );
}
