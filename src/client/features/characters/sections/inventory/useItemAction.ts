import { useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useToasts } from '../../../../lib/toast.tsx';

/** Run one structural item edit; a local failure toasts and flashes the editor. */
export function useItemAction(item: InventoryItemOut) {
  const toasts = useToasts();
  const flash = useFlashState(undefined, undefined, `character_inventory:${item.id}:`);
  const [pending, setPending] = useState(false);
  async function run(label: string, action: () => Promise<void>, done?: () => void) {
    setPending(true);
    try {
      await action();
      done?.();
    } catch (error) {
      flash.trigger();
      toasts.push(`Couldn't ${label} — ${error instanceof Error ? error.message : String(error)}`, {
        kind: 'error',
      });
    } finally {
      setPending(false);
    }
  }
  return { run, pending, flash };
}
