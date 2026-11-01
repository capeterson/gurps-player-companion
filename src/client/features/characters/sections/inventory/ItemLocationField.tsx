import { useLiveQuery } from 'dexie-react-hooks';
import { useId } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { getLocalDb } from '../../../../db/dexie.ts';
import { useDraftField } from '../../../../hooks/useDraftField.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { ItemField } from './ItemField.tsx';
import { revealContainers } from './inventoryEditorState.ts';
import {
  type MovableRow,
  locationValue,
  moveInventoryItems,
  moveTargetContainers,
  targetFromValue,
} from './inventoryMoves.ts';

/** The character's stored inventory rows, live from Dexie. */
export function useInventoryRows(characterId: string): MovableRow[] | undefined {
  return useLiveQuery(
    async () =>
      (await getLocalDb()
        .characterInventory.where('characterId')
        .equals(characterId)
        .toArray()) as MovableRow[],
    [characterId],
  );
}

/** A container and every container around it, innermost first. */
function containerChain(rows: readonly MovableRow[], id: string): string[] {
  const chain: string[] = [];
  let current: string | null = id;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = rows.find((row) => row.id === current)?.parentId ?? null;
  }
  return chain;
}

/**
 * One Location control for an item: on the player, stashed (with where), or
 * inside a container. Moves use the same patches and checks as the bulk
 * Move menu and drag and drop.
 */
export function ItemLocationField({ item, label }: { item: InventoryItemOut; label: string }) {
  const id = useId();
  const rows = useInventoryRows(item.characterId);
  // Every move patches worn and parentId; a rollback of any location field
  // pulses this one control.
  const parentFlash = useFlashState(makeFlashKey('character_inventory', item.id, 'parentId'));
  const stashFlash = useFlashState(
    makeFlashKey('character_inventory', item.id, 'externalLocation'),
  );
  const draft = useDraftField<string>({
    name: `${item.name}: ${label}`,
    serverValue: locationValue(item),
    onSave: async (value) => {
      const target = targetFromValue(value);
      await moveInventoryItems({
        characterId: item.characterId,
        ids: [item.id],
        target,
        label: item.name,
      });
      // Keep the moved item and its open editor in view inside the container.
      if (target.kind === 'container')
        revealContainers(item.characterId, containerChain(rows ?? [], target.id));
    },
    enqueueOnCommit: {
      readCommitted: async () => {
        const row = await getLocalDb().characterInventory.get(item.id);
        return locationValue(row ?? item);
      },
    },
    flashKey: makeFlashKey('character_inventory', item.id, 'worn'),
  });
  const flash = [draft.flashing, parentFlash.flashing, stashFlash.flashing].some(Boolean);
  const containers = moveTargetContainers(rows ?? [], [item.id]);
  // The current container stays listed while rows load or if it was renamed.
  const parentListed = !item.parentId || containers.some((row) => row.id === item.parentId);
  return (
    <>
      <div className="min-w-0">
        <label htmlFor={id} className="flex flex-col gap-1 text-sm">
          <span className="label-eyebrow">{label}</span>
          <select
            id={id}
            value={draft.value}
            data-flashing={flash ? 'true' : 'false'}
            data-flash-parity={draft.inputProps['data-flash-parity']}
            onChange={(event) => {
              draft.setValue(event.target.value);
              draft.commit();
            }}
            className="field-rollback-flash select select-sm select-bordered w-full min-w-0"
          >
            <option value="player">On the player</option>
            <option value="stashed">Stashed</option>
            {!parentListed && item.parentId && (
              <option value={item.parentId}>In its current container</option>
            )}
            {containers.map((container) => (
              <option key={container.id} value={container.id}>
                In {container.name}
              </option>
            ))}
          </select>
        </label>
        {draft.error && <p className="text-xs text-error mt-1">{draft.error}</p>}
      </div>
      {draft.value === 'stashed' && item.parentId === null && (
        <ItemField
          item={item}
          spec={{ path: 'externalLocation', label: 'Stash location', optional: true }}
          more
        />
      )}
    </>
  );
}
