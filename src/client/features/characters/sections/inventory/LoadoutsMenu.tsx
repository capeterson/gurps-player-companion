import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { loadoutDelta, nextLoadoutSortOrder } from '../../../../../shared/domain/loadouts.ts';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { AppIcon } from '../../../../components/ui/AppIcon.tsx';
import { InfoTooltip } from '../../../../components/ui/InfoTooltip.tsx';
import { useAppHeaderBottom } from '../../../../hooks/useAppHeaderBottom.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useViewportBoundedOverlay } from '../../../../hooks/useViewportBoundedOverlay.ts';
import { useToasts } from '../../../../lib/toast.tsx';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { InventoryAnchorLink } from '../../InventoryAnchorLink.tsx';
import {
  createLoadout,
  equipLoadout,
  moveLoadout,
  restoreLastEquipped,
} from './loadoutMutations.ts';
import { describeSwitch } from './loadoutPresentation.ts';
import type { CharacterLoadouts } from './useCharacterLoadouts.ts';

type ActiveState = 'exact' | 'changed';

const ACTIVE_CLASS: Record<ActiveState, string> = {
  exact: 'font-semibold text-primary',
  changed: 'italic text-base-content/60',
};

/**
 * Loadouts dropdown in the Inventory toolbar: equip, edit, reorder and create
 * loadouts, and restore Last Equipped. The button names the last equipped
 * loadout, emphasized while the equipment still matches it.
 */
export function LoadoutsMenu({
  characterId,
  canWrite,
  items,
  basicLift,
  data,
  onEdit,
}: {
  characterId: string;
  canWrite: boolean;
  items: readonly InventoryItemOut[];
  /** Absent while sheet mechanics are unavailable: no encumbrance wording. */
  basicLift: number | undefined;
  data: CharacterLoadouts;
  /** `created` opens the editor with the default name selected. */
  onEdit: (loadoutId: string, created?: boolean) => void;
}) {
  const toasts = useToasts();
  const headerBottom = useAppHeaderBottom();
  const [open, setOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [movedHandle, setMovedHandle] = useState<{ id: string; index: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useViewportBoundedOverlay<HTMLDivElement>(open, undefined, {
    shiftVertically: true,
    minimumTop: headerBottom,
  });
  const buttonFlash = useFlashState(makeFlashKey('character', characterId, 'lastEquipmentSwitch'));
  const { loadouts, lastSwitch } = data;
  const active = loadouts.find((loadout) => loadout.id === lastSwitch?.activeLoadoutId);
  const delta = active ? loadoutDelta(items, active) : null;
  const activeState: ActiveState | null = delta ? (delta.exact ? 'exact' : 'changed') : null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  // Keyboard reordering keeps focus on the moved handle once the new order renders.
  useEffect(() => {
    if (!movedHandle || loadouts[movedHandle.index]?.id !== movedHandle.id) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-loadout-handle="${movedHandle.id}"]`)
      ?.focus();
    setMovedHandle(null);
  }, [movedHandle, loadouts]);

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action();
    } catch (err) {
      toasts.push(`${failure} — ${(err as Error).message}`, { kind: 'error' });
    }
  }

  function equip(loadout: (typeof loadouts)[number]) {
    setOpen(false);
    void run(async () => {
      const plan = await equipLoadout(characterId, loadout);
      toasts.push(describeSwitch(`Equipped ${loadout.name}`, plan, items, basicLift), {
        kind: 'success',
        action: { label: 'Restore', onClick: restore },
      });
    }, `Couldn't equip ${loadout.name}`);
  }

  function restore() {
    setOpen(false);
    void run(async () => {
      const plan = await restoreLastEquipped(characterId);
      toasts.push(describeSwitch('Restored Last Equipped', plan, items, basicLift), {
        kind: 'success',
      });
    }, "Couldn't restore Last Equipped");
  }

  function create() {
    setOpen(false);
    void run(async () => {
      const id = await createLoadout(characterId, {
        name: 'New loadout',
        itemIds: items.filter((item) => item.equipped).map((item) => item.id),
        sortOrder: nextLoadoutSortOrder(loadouts),
      });
      onEdit(id, true);
    }, "Couldn't create a loadout");
  }

  function move(from: number, to: number) {
    const moved = loadouts[from];
    if (!moved || to < 0 || to >= loadouts.length) return;
    setMovedHandle({ id: moved.id, index: to });
    void run(() => moveLoadout(characterId, loadouts, from, to), `Couldn't reorder ${moved.name}`);
  }

  function handleKey(event: KeyboardEvent, index: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  }

  function drop(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragFrom !== null) move(dragFrom, index);
    setDragFrom(null);
  }

  const label = active ? (
    <>
      <span className="sr-only">Loadouts: </span>
      <span className={activeState ? ACTIVE_CLASS[activeState] : ''}>{active.name}</span>
    </>
  ) : (
    'Loadouts'
  );
  const toggle = (describedBy?: string) => (
    <button
      type="button"
      className="btn btn-sm field-rollback-flash"
      aria-expanded={open}
      aria-haspopup="menu"
      aria-describedby={describedBy}
      onClick={() => setOpen((value) => !value)}
      {...buttonFlash.flashProps}
    >
      {label} ▾
    </button>
  );
  const tooltip = delta && !delta.exact && (
    <div className="space-y-1">
      {delta.extraEquipped.length > 0 && (
        <p>
          Also equipped: <ItemLinks items={delta.extraEquipped} />
        </p>
      )}
      {delta.missing.length > 0 && (
        <p>
          Not equipped: <ItemLinks items={delta.missing} />
        </p>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className={`dropdown dropdown-end ${open ? 'dropdown-open' : ''}`}>
      {tooltip ? (
        <InfoTooltip content={tooltip} side="top" scrollable renderTrigger={toggle} />
      ) : (
        toggle()
      )}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Loadouts"
          style={{
            marginRight: 'calc(0px - var(--viewport-overlay-shift-x, 0px))',
            marginTop: 'var(--viewport-overlay-shift-y, 0px)',
            maxHeight:
              'min(24rem, calc(100dvh - 1rem), var(--viewport-overlay-available-height, 100dvh))',
          }}
          className="dropdown-content z-30 mt-1 w-72 max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] overflow-y-auto [overflow-wrap:anywhere] rounded-box border border-base-300/60 bg-base-100 p-1 text-sm shadow-lg"
        >
          {loadouts.length === 0 && <p className="px-3 py-2 text-base-content/60">No loadouts</p>}
          <ul className="flex flex-col">
            {loadouts.map((loadout, index) => (
              <LoadoutRow
                key={loadout.id}
                id={loadout.id}
                name={loadout.name}
                nameClass={
                  loadout.id === active?.id && activeState ? ACTIVE_CLASS[activeState] : ''
                }
                canWrite={canWrite}
                dragging={dragFrom === index}
                onEquip={() => equip(loadout)}
                onEdit={() => {
                  setOpen(false);
                  onEdit(loadout.id);
                }}
                onHandleKey={(event) => handleKey(event, index)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', loadout.id);
                  setDragFrom(index);
                }}
                onDragEnd={() => setDragFrom(null)}
                onDrop={(event) => drop(event, index)}
              />
            ))}
          </ul>
          {canWrite && (
            <ul className="menu menu-sm mt-1 w-full border-t border-base-300/60 p-0 pt-1">
              {lastSwitch && (
                <li>
                  <button type="button" role="menuitem" onClick={restore}>
                    Restore Last Equipped
                  </button>
                </li>
              )}
              <li>
                <button type="button" role="menuitem" onClick={create}>
                  New loadout
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ItemLinks({ items }: { items: readonly InventoryItemOut[] }) {
  return items.map((item, index) => (
    <span key={item.id}>
      {index > 0 && ', '}
      <InventoryAnchorLink itemId={item.id}>{item.name}</InventoryAnchorLink>
    </span>
  ));
}

function LoadoutRow({
  id,
  name,
  nameClass,
  canWrite,
  dragging,
  onEquip,
  onEdit,
  onHandleKey,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  id: string;
  name: string;
  nameClass: string;
  canWrite: boolean;
  dragging: boolean;
  onEquip: () => void;
  onEdit: () => void;
  onHandleKey: (event: KeyboardEvent) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const flash = useFlashState(undefined, undefined, `character_loadout:${id}:`);
  return (
    <li
      className={`field-rollback-flash flex items-center gap-1 rounded-field px-1 py-0.5 ${dragging ? 'opacity-50' : ''}`}
      onDragOver={(event) => {
        if (!canWrite) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
      {...flash.flashProps}
    >
      {canWrite && (
        <button
          type="button"
          draggable
          data-loadout-handle={id}
          aria-label={`Reorder ${name}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          className="btn btn-ghost btn-xs cursor-grab px-1 text-base-content/50"
          onKeyDown={onHandleKey}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <AppIcon name="gripVertical" size={14} />
        </button>
      )}
      <span className={`min-w-0 flex-1 px-1 ${nameClass}`}>{name}</span>
      {canWrite && (
        <>
          <button type="button" role="menuitem" className="btn btn-xs" onClick={onEquip}>
            Equip
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label={`Edit ${name}`}
            className="btn btn-ghost btn-xs"
            onClick={onEdit}
          >
            <AppIcon name="edit" size={14} />
          </button>
        </>
      )}
    </li>
  );
}
