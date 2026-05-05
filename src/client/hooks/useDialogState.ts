/**
 * Sync a `<dialog>` element with a controlled boolean. Calls
 * `showModal()` when `open` flips true and `close()` when it flips
 * false, guarded so we never call either when the dialog is already
 * in that state (which throws in some browsers).
 */

import { type RefObject, useEffect, useRef } from 'react';

export function useDialogState(open: boolean): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);
  return ref;
}
