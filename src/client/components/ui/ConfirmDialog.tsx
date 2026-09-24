/**
 * Modal confirmation dialog. Replaces `window.confirm()` — those are
 * jarring, lose theming, and can't carry rich context. Use this for
 * any destructive op (delete item, drop trait, etc.).
 */

import { type ReactNode, useId } from 'react';
import { useDialogState } from '../../hooks/useDialogState.ts';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'error';
  pending?: boolean;
  pendingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  pending = false,
  pendingLabel = 'Working…',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useDialogState(open);
  const titleId = useId();
  const confirmClass = tone === 'error' ? 'btn-error' : 'btn-primary';

  return (
    // Don't bind `onClose`: it fires on every dialog close, including
    // the programmatic `dlg.close()` that useDialogState runs after a
    // successful confirm — wiring `onCancel` there would invoke the
    // cancel callback on every confirm path. The native `cancel` event
    // fires only on Esc; we preventDefault and route through the
    // controlled `open` prop so there's a single source of truth, then
    // notify the parent.
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl">
        <h3 id={titleId} className="font-display text-xl font-semibold">
          {title}
        </h3>
        {children && <div className="py-3 text-sm">{children}</div>}
        <div className="modal-action">
          <button type="button" onClick={onCancel} disabled={pending} className="btn btn-ghost">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`btn ${confirmClass}`}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onCancel} disabled={pending}>
          close
        </button>
      </form>
    </dialog>
  );
}
