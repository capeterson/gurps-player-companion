/**
 * One-time display of a freshly minted API key.
 *
 * Unlike the standard ConfirmDialog this modal cannot be dismissed via
 * Escape or backdrop click — the plaintext is unrecoverable, so an
 * accidental dismissal would force the user to mint a new key.
 */

import { useState } from 'react';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { useToasts } from '../../lib/toast.tsx';

export function ApiKeyCreatedDialog({
  plaintextKey,
  open,
  onAcknowledge,
}: {
  plaintextKey: string;
  open: boolean;
  onAcknowledge: () => void;
}) {
  const ref = useDialogState(open);
  const toasts = useToasts();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintextKey);
      setCopied(true);
      toasts.push('Copied to clipboard', { kind: 'success' });
    } catch {
      toasts.push("Couldn't copy — select the text and copy manually", { kind: 'error' });
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="modal"
      // No onClose / onCancel handler: this modal must be acknowledged
      // explicitly via the button below so the user can't accidentally
      // lose the plaintext key (it's unrecoverable).
    >
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl">
        <h3 className="font-display text-xl font-semibold">Save your API key</h3>
        <div className="py-3 text-sm space-y-3">
          <p>
            This is the <strong>only time</strong> the plaintext key will be shown. Copy it
            somewhere safe (a password manager or your shell config). If you lose it, you'll need to
            revoke and mint a new one.
          </p>
          <code className="block break-all rounded border border-base-300 bg-base-200 px-3 py-2 text-xs num">
            {plaintextKey}
          </code>
          <button type="button" className="btn btn-sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </div>
        <div className="modal-action">
          <button type="button" className="btn btn-primary" onClick={onAcknowledge}>
            I've saved it
          </button>
        </div>
      </div>
    </dialog>
  );
}
