import { useState } from 'react';
import type { InventoryItemOut } from '../../../../../shared/schemas/inventory.ts';
import { RepriceEntry } from '../../../library/RepriceEntry.tsx';
import { mutateItem } from './itemMutations.ts';
import { useItemAction } from './useItemAction.ts';

/**
 * Library link status, saved pricing and Unlink in one place. Unlinking keeps
 * the item's own price, weight and categories but drops the library pricing
 * record, so the item no longer offers library recalculation.
 */
export function ItemLibraryLink({ item }: { item: InventoryItemOut }) {
  const { run, pending } = useItemAction(item);
  const [confirming, setConfirming] = useState(false);
  return (
    <RepriceEntry section="items" entry={item}>
      {item.libraryItemId &&
        (confirming ? (
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-2">
            <p className="text-sm break-words">
              Unlink from the campaign library? The item keeps its current price, weight and
              settings.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Keep link
            </button>
            <button
              type="button"
              className="btn btn-sm btn-error"
              disabled={pending}
              onClick={() =>
                void run(
                  'unlink the library item',
                  // The link goes first: a pricing write against a still-linked
                  // row is checked against that library entry on the server.
                  () =>
                    mutateItem(item.id, 'Library link', () => ({
                      libraryItemId: null,
                      pricingResolution: null,
                    })),
                  () => setConfirming(false),
                )
              }
            >
              Unlink
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Unlink ${item.name} from the campaign library`}
            onClick={() => setConfirming(true)}
          >
            Unlink
          </button>
        ))}
    </RepriceEntry>
  );
}
