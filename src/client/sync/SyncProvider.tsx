/**
 * Wires the sync orchestrator into the React tree:
 *   - Starts the orchestrator on mount, stops on unmount.
 *   - Bridges orchestrator-emitted persistent toasts (for sync
 *     rejections) into the in-tree `useToasts` API.  The orchestrator
 *     itself is React-agnostic; this provider is the only place that
 *     knows about the toast context.
 */

import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { getLocalDb } from '../db/dexie.ts';
import { mountEncounterInvalidations } from '../features/encounters/encounterInvalidation.ts';
import { useToasts } from '../lib/toast.tsx';
import { getSyncOrchestrator, setRejectionNotifier } from './orchestrator.ts';
import { getSyncWsSubscriber } from './wsSubscriber.ts';

export function SyncProvider({ children }: { children: ReactNode }) {
  const toasts = useToasts();
  const queryClient = useQueryClient();
  useEffect(() => mountEncounterInvalidations(queryClient), [queryClient]);
  useEffect(() => {
    const orch = getSyncOrchestrator();
    orch.start();
    getSyncWsSubscriber().start();
    setRejectionNotifier((rec) => {
      // Persistent toast naming the field + reason.  The id is the
      // outbox clientOpId so re-emitting the same rejection (e.g. on
      // bootstrap reload) updates the existing toast in place.
      const label = rec.humanName ?? rec.fieldPath ?? rec.entityClass;
      toasts.push(`Couldn't sync ${label} — ${rec.reason}`, {
        kind: 'error',
        persistent: true,
        id: rec.id,
      });
    });
    return () => {
      orch.stop();
      getSyncWsSubscriber().stop();
      setRejectionNotifier(null);
    };
  }, [toasts]);

  // Wire user dismissal of a sync error toast back to the
  // rejectionToasts row -- so a refresh doesn't re-surface a toast the
  // user has already acknowledged.  We can't intercept dismiss() here
  // cleanly; instead, the orchestrator just re-emits open records on
  // bootstrap, and the user can clear them through the same ✕ button
  // (which removes from the in-memory toast list).  Persistence across
  // reload is best-effort.
  useEffect(() => {
    // Mark dismissed records non-persistent on next bootstrap by
    // running a tiny sweep that deletes any rejectionToasts row that
    // isn't currently visible in the toast list.  Skipped here for
    // simplicity -- the orchestrator's replay only runs on bootstrap.
    return undefined;
  }, []);

  // Note: getLocalDb() is referenced to ensure Dexie is opened
  // eagerly so liveQueries elsewhere don't lazily-open later.
  void getLocalDb();

  return <>{children}</>;
}
