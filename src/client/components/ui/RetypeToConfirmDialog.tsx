/**
 * Modal confirmation dialog gated by retyping an expected string (e.g.
 * the campaign name) before the destructive button unlocks — the
 * "type DELETE to confirm" pattern. Extracted from DeleteCampaignDialog
 * and TransferOwnershipDialog, which were ~85% identical (same
 * useDialogState wiring, typed-name-match gate, reset-on-close, modal
 * shell). Both are now thin wrappers around this component; keep new
 * "retype to confirm" flows on this shared shell instead of forking a
 * third copy.
 */

import { type ReactNode, useEffect, useState } from 'react';
import { useDialogState } from '../../hooks/useDialogState.ts';

interface RetypeToConfirmDialogProps {
  open: boolean;
  title: string;
  /** Danger copy / context rendered above the retype input. */
  children: ReactNode;
  /** The exact string the user must retype to unlock the confirm button. */
  expectedText: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RetypeToConfirmDialog({
  open,
  title,
  children,
  expectedText,
  confirmLabel,
  pendingLabel,
  pending,
  onConfirm,
  onCancel,
}: RetypeToConfirmDialogProps) {
  const ref = useDialogState(open);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  // Conditional mount keeps the page DOM clean when dismissed — a native
  // <dialog> would otherwise leave its children in the tree even when
  // not opened via showModal().
  if (!open) return null;

  const matches = typed.trim() === expectedText;

  return (
    <dialog ref={ref} className="modal" onClose={onCancel} onCancel={onCancel}>
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl">
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        <div className="py-3 text-sm space-y-3">
          {children}
          <p>
            To confirm, type the campaign name{' '}
            <code className="px-1 rounded bg-base-200">{expectedText}</code> below.
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectedText}
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
            {pending ? pendingLabel : confirmLabel}
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
