/**
 * Owner-only confirmation modal for transferring ownership to another
 * member.  The user has to retype the campaign name to enable the
 * destructive button — the same paranoia gate gpw uses.
 */

import { useEffect, useState } from 'react';
import type { CampaignMemberOut } from '../../../shared/schemas/campaign.ts';
import { useDialogState } from '../../hooks/useDialogState.ts';

export function TransferOwnershipDialog({
  open,
  campaignName,
  target,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  campaignName: string;
  target: CampaignMemberOut | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useDialogState(open);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  // Conditional mount keeps the page DOM clean when dismissed — a native
  // <dialog> would otherwise leave its children in the tree even when
  // not opened via showModal().
  if (!open) return null;

  const matches = typed.trim() === campaignName;

  return (
    <dialog ref={ref} className="modal" onClose={onCancel} onCancel={onCancel}>
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl">
        <h3 className="font-display text-xl font-semibold">Transfer campaign ownership?</h3>
        <div className="py-3 text-sm space-y-3">
          <p>
            <strong>{target?.displayName}</strong> will become the owner. You will lose owner
            privileges and become a regular member. This cannot be undone unless the new owner
            transfers it back.
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
            {pending ? 'Transferring…' : 'Transfer ownership'}
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
