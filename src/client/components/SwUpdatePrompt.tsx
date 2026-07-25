/**
 * Surfaces "a new version of the app is available" as a persistent
 * toast with a Reload action.
 *
 * Why this exists: `registerSwLifecycle` has always dispatched
 * `gpc:sw-update-ready` with a `reload()` callback, and nothing
 * listened — the callback was dropped on the floor. Combined with a
 * SPA router that never triggers a navigation (and so never triggers
 * the browser's own SW update check), a tab left open for days ran
 * stale JS with no way to find out. The detection half lives in
 * `src/sw/registerSW.ts`; this is the telling-the-user half.
 *
 * Renders nothing. Must be mounted inside `<ToastProvider>`.
 */

import { useEffect } from 'react';
import { getPendingSwUpdate, swEvents } from '../../sw/registerSW.ts';
import { useToasts } from '../lib/toast.tsx';

/** Stable id so a repeated announcement updates in place, never stacks. */
const TOAST_ID = 'sw-update-ready';

export function SwUpdatePrompt() {
  const toasts = useToasts();

  useEffect(() => {
    const announce = (reload: () => void) => {
      toasts.push('A new version of the app is available.', {
        kind: 'info',
        // The update doesn't stop being true after 3.5 seconds, and a
        // reload is disruptive enough that it must stay the user's
        // call -- so: persistent, dismissible, never automatic.
        persistent: true,
        id: TOAST_ID,
        action: { label: 'Reload', onClick: reload },
      });
    };

    // An update discovered during startup (before React mounted) is
    // latched rather than lost.
    const already = getPendingSwUpdate();
    if (already) announce(already);

    const onUpdateReady = (event: Event) => {
      const reload = (event as CustomEvent<{ reload?: () => void }>).detail?.reload;
      if (typeof reload === 'function') announce(reload);
    };

    window.addEventListener(swEvents.UPDATE_READY, onUpdateReady);
    return () => window.removeEventListener(swEvents.UPDATE_READY, onUpdateReady);
  }, [toasts]);

  return null;
}
