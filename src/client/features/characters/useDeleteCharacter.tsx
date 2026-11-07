/**
 * Delete a whole character: confirm, queue the delete through the outbox, and
 * offer Undo. Deleting moves the character to the recycle bin (restorable for
 * 30 days); Undo restores it. Restoring is an online REST call, so Undo first
 * lets the queued delete reach the server, then restores and pulls the sheet back.
 */

import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { getSyncOrchestrator } from '../../sync/orchestrator.ts';
import { enqueueDelete } from '../../sync/outbox.ts';

export interface DeleteCharacter {
  /** Open the confirmation dialog. */
  readonly request: () => void;
  readonly dialog: ReactNode;
}

export function useDeleteCharacter(character: { id: string; name: string }): DeleteCharacter {
  const toasts = useToasts();
  const [open, setOpen] = useState(false);

  const undo = async () => {
    try {
      // The delete may still be queued; restore only exists once it landed.
      await getSyncOrchestrator().syncNow();
      await api(`/characters/${character.id}/restore`, { method: 'POST' });
      await getSyncOrchestrator().syncNow();
      toasts.push(`Restored ${character.name}`, { kind: 'success' });
    } catch (err) {
      toasts.push(`Couldn't restore ${character.name} — ${(err as Error).message}`, {
        kind: 'error',
      });
    }
  };

  const remove = async () => {
    try {
      await enqueueDelete({
        entityClass: 'character',
        entityId: character.id,
        humanName: `character "${character.name}"`,
      });
      toasts.push(`Deleted ${character.name}`, {
        kind: 'success',
        action: { label: 'Undo', onClick: () => void undo() },
      });
    } catch (err) {
      toasts.push(`Couldn't delete ${character.name} — ${(err as Error).message}`, {
        kind: 'error',
      });
    }
  };

  return {
    request: () => setOpen(true),
    dialog: (
      <ConfirmDialog
        open={open}
        title="Delete character?"
        confirmLabel="Delete"
        tone="error"
        onConfirm={() => {
          setOpen(false);
          void remove();
        }}
        onCancel={() => setOpen(false)}
      >
        <p>
          <strong>{character.name}</strong> moves to the recycle bin and is permanently deleted
          after 30 days.
        </p>
      </ConfirmDialog>
    ),
  };
}
