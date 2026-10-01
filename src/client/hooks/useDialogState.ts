/**
 * Sync a `<dialog>` element with a controlled boolean. Calls
 * `showModal()` when `open` flips true and `close()` when it flips
 * false, guarded so we never call either when the dialog is already
 * in that state (which throws in some browsers).
 */

import { type RefObject, useLayoutEffect, useRef } from 'react';

export function useDialogState(open: boolean): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const updateViewport = () => {
      const viewport = window.visualViewport;
      dlg.dataset.viewportBounded = 'true';
      dlg.style.setProperty('--dialog-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
      dlg.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      dlg.style.setProperty('--dialog-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
      dlg.style.setProperty(
        '--dialog-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    updateViewport();
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
    if (!open) return;
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, [open]);
  return ref;
}
