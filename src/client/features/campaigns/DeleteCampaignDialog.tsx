/**
 * Owner-only campaign deletion dialog with the same retype-name gate
 * as TransferOwnershipDialog.
 */

import { useEffect, useState } from 'react';
import { useDialogState } from '../../hooks/useDialogState.ts';

export function DeleteCampaignDialog({
  open,
  campaignName,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  campaignName: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialogState(open);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  if (!open) return null;

  const matches = typed.trim() === campaignName;

  return (
    <dialog ref={ref} className="modal" onClose={onCancel} onCancel={onCancel}>
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl">
        <h3 className="font-display text-xl font-semibold">Delete campaign?</h3>
        <div className="py-3 text-sm space-y-3">
          <p>
            <strong>{campaignName}</strong> and all of its memberships will be removed for everyone.
            Characters in it will become campaign-less. This cannot be undone from the UI.
          </p>
          <p>
            To confirm, type the campaign name{' '}
            <code className="px-1 rounded bg-base-200">{campaignName}</code> below.
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={campaignName}
            aria-label="Type campaign name to confirm"
            className="input input-bordered w-full"
          />
        </div>
        <div className="modal-action">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || pending}
            className="btn btn-error"
          >
            {pending ? 'Deleting…' : 'Delete campaign'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onCancel}>
          close
        </button>
      </form>
    </dialog>
  );
}
