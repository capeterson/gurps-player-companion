import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { LOADOUT_NAME_MAX } from '../../../../../shared/schemas/loadout.ts';
import type { LocalCharacterLoadout } from '../../../../db/dexie.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { useDraftField } from '../../../../hooks/useDraftField.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useToasts } from '../../../../lib/toast.tsx';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { filterInventoryTree } from '../inventoryTree.ts';
import { deleteLoadout, renameLoadout, setLoadoutItem } from './loadoutMutations.ts';

/** Inline editor for one loadout: name, item checklist and deletion. */
export function LoadoutEditor({
  characterId,
  loadout,
  items,
  focusName,
  onClose,
}: {
  characterId: string;
  loadout: LocalCharacterLoadout;
  items: readonly InventoryItemOut[];
  focusName?: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const toasts = useToasts();
  const nameRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const itemsFlash = useFlashState(makeFlashKey('character_loadout', loadout.id, 'itemIds'));
  const name = useDraftField<string>({
    name: 'Loadout name',
    serverValue: loadout.name,
    parse: (raw) => raw.trim(),
    validate: (value) =>
      value === ''
        ? 'Enter a name'
        : value.length > LOADOUT_NAME_MAX
          ? `Use ${LOADOUT_NAME_MAX} characters or fewer`
          : null,
    onSave: (value) => renameLoadout(characterId, loadout.id, value),
    enqueueOnCommit: {
      readCommitted: async () =>
        (await getLocalDb().characterLoadouts.get(loadout.id))?.name ?? loadout.name,
    },
    flashKey: makeFlashKey('character_loadout', loadout.id, 'name'),
  });

  useEffect(() => {
    if (!focusName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [focusName]);

  const selected = new Set(loadout.itemIds);
  // A click shows at once; the stored loadout takes over once it agrees.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    const stored = new Set(loadout.itemIds);
    setPending((current) =>
      [...current].some(([itemId, included]) => stored.has(itemId) === included)
        ? new Map([...current].filter(([itemId, included]) => stored.has(itemId) !== included))
        : current,
    );
  }, [loadout.itemIds]);
  const tree = useMemo(() => filterInventoryTree(items, filter), [items, filter]);
  const sections = [
    { label: 'On the player', roots: (tree.byParent.get(null) ?? []).filter((item) => item.worn) },
    { label: 'Stashed', roots: (tree.byParent.get(null) ?? []).filter((item) => !item.worn) },
  ];

  function toggle(item: InventoryItemOut, included: boolean) {
    setPending((current) => new Map(current).set(item.id, included));
    setLoadoutItem(loadout.id, item.id, included).catch((err: Error) => {
      setPending((current) => new Map([...current].filter(([itemId]) => itemId !== item.id)));
      toasts.push(`Couldn't change ${loadout.name} — ${err.message}`, { kind: 'error' });
    });
  }

  function rows(list: readonly InventoryItemOut[], depth: number): ReactNode {
    return list.map((item) => (
      <li key={item.id}>
        <label
          className="flex min-h-8 items-center gap-2 rounded-field px-2 hover:bg-base-200"
          style={{ paddingLeft: `${0.5 + Math.min(depth, 6) * 1.25}rem` }}
        >
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={pending.get(item.id) ?? selected.has(item.id)}
            onChange={(event) => toggle(item, event.target.checked)}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
        </label>
        {(tree.byParent.get(item.id)?.length ?? 0) > 0 && (
          <ul>{rows(tree.byParent.get(item.id) ?? [], depth + 1)}</ul>
        )}
      </li>
    ));
  }

  return (
    <section
      aria-label={`Loadout ${loadout.name}`}
      className="min-w-0 space-y-4 rounded-xl border border-base-300 bg-base-200/60 p-3 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg">Loadout</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
      <label htmlFor={`${id}-name`} className="flex max-w-sm flex-col gap-1 text-sm">
        <span className="label-eyebrow">Name</span>
        <input
          {...name.inputProps}
          ref={nameRef}
          id={`${id}-name`}
          maxLength={LOADOUT_NAME_MAX}
          className="field-rollback-flash input input-sm input-bordered w-full min-w-0"
          aria-invalid={name.error != null}
          aria-describedby={name.error ? `${id}-name-error` : undefined}
        />
        {name.error && (
          <span id={`${id}-name-error`} className="text-xs text-error">
            {name.error}
          </span>
        )}
      </label>
      <fieldset
        className="field-rollback-flash min-w-0 space-y-2 rounded-lg"
        {...itemsFlash.flashProps}
      >
        <legend className="label-eyebrow mb-1">Items</legend>
        {items.length > 0 ? (
          <>
            <input
              type="search"
              className="input input-bordered input-sm w-full min-w-0 sm:max-w-xs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter item names…"
              aria-label="Filter loadout items"
            />
            <div className="max-h-80 overflow-y-auto rounded-lg border border-base-300 bg-base-100 py-1">
              {sections.map(
                (section) =>
                  section.roots.length > 0 && (
                    <div key={section.label}>
                      <h4 className="px-2 pt-1 text-xs font-medium text-base-content/60">
                        {section.label}
                      </h4>
                      <ul>{rows(section.roots, 0)}</ul>
                    </div>
                  ),
              )}
              {tree.matchedIds.size === 0 && (
                <p className="px-2 py-1 text-sm text-base-content/60">No matching items</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-base-content/60">No inventory items</p>
        )}
      </fieldset>
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Delete {loadout.name}? Its items stay in the inventory.</span>
          <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
          <button
            type="button"
            className="btn btn-sm btn-error"
            onClick={() => {
              onClose();
              deleteLoadout(characterId, loadout.id, loadout.name).catch((err: Error) =>
                toasts.push(`Couldn't delete ${loadout.name} — ${err.message}`, { kind: 'error' }),
              );
            }}
          >
            Delete
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm text-error"
          onClick={() => setConfirmDelete(true)}
        >
          Delete loadout
        </button>
      )}
    </section>
  );
}
