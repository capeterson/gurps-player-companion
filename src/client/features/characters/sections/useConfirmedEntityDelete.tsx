/**
 * Delete-with-confirmation for one character sub-entity row (trait,
 * skill, spell, language, technique). Each row panel used to hand-roll
 * the same confirm state, `enqueueDelete` call, error toast and
 * `ConfirmDialog`; this hook owns all of it. Render `dialog` inside the
 * row and call `request` from its delete button.
 */

import { type ReactNode, useState } from 'react';
import type { EntityClass } from '../../../../shared/schemas/sync.ts';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.tsx';
import { useToasts } from '../../../lib/toast.tsx';
import { enqueueDelete } from '../../../sync/outbox.ts';

export interface ConfirmedEntityDelete {
  /** Open the confirmation dialog. */
  readonly request: () => void;
  readonly dialog: ReactNode;
}

export function useConfirmedEntityDelete({
  entityClass,
  noun,
  label,
  entity,
  characterId,
}: {
  entityClass: EntityClass;
  /** Lower-case kind shown to the user, e.g. "trait". */
  noun: string;
  /** The entry's display name. */
  label: string;
  /** The local row; kept as the delete's rollback value. */
  entity: { readonly id: string };
  characterId: string;
}): ConfirmedEntityDelete {
  const toasts = useToasts();
  const [open, setOpen] = useState(false);

  const remove = async () => {
    try {
      await enqueueDelete({
        entityClass,
        entityId: entity.id,
        humanName: `${noun} "${label}"`,
        characterId,
        prevValue: entity,
      });
    } catch (err) {
      toasts.push(`Couldn't delete ${noun} — ${(err as Error).message}`, { kind: 'error' });
    }
  };

  return {
    request: () => setOpen(true),
    dialog: (
      <ConfirmDialog
        open={open}
        title={`Delete ${noun} "${label}"?`}
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          setOpen(false);
          void remove();
        }}
        onCancel={() => setOpen(false)}
      />
    ),
  };
}
