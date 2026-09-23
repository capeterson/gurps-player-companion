/**
 * Toolbar sync indicator.
 *
 * Icon-only control with a DaisyUI tooltip that surfaces:
 *   - Current sync state (synced / syncing / error / offline)
 *   - Local IndexedDB storage usage & percentage of browser quota
 *
 * Min-1-second state visibility is enforced inside the store (see
 * src/client/sync/state.ts) so transient states are perceptible even
 * when the underlying sync resolves before the next repaint.
 *
 * Storage is sampled lazily (staleTime 30s) so the badge doesn't
 * hammer navigator.storage.estimate() on every render.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { formatBytes, readLocalDbStatus } from '../lib/localDbStatus.ts';
import { useSyncStatus } from '../sync/useSyncIndicatorState.ts';
import { SyncLogView } from './SyncLogView.tsx';
import { InfoTooltip } from './ui/InfoTooltip.tsx';

export function SyncStatusIndicator({ triggerClassName = '' }: { triggerClassName?: string } = {}) {
  const { state, error } = useSyncStatus();

  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [logOpen, setLogOpen] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const storage = useQuery({
    queryKey: ['sync-indicator', 'storage'],
    queryFn: readLocalDbStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // A sync failure stays actionable when connectivity also drops.
  const visualState = state === 'error' ? 'error' : !online ? 'offline' : state;
  const meta = STATE_META[visualState];

  // Build a single-line tooltip: state message · storage info
  const statusMsg = error
    ? `${error.reason}${online ? '' : ' · Offline'} — click for details`
    : meta.tooltip;

  let storageMsg = '';
  if (storage.data) {
    const { storageUsageBytes: used, storageQuotaBytes: quota } = storage.data;
    if (used !== null) {
      if (quota !== null && quota > 0) {
        const pct = ((used / quota) * 100).toFixed(1);
        storageMsg = `Local storage: ${formatBytes(used)} / ${formatBytes(quota)} (${pct}%)`;
      } else {
        storageMsg = `Local storage: ${formatBytes(used)}`;
      }
    }
  }

  const tip = storageMsg ? `${statusMsg}  ·  ${storageMsg}` : statusMsg;

  return (
    <>
      <InfoTooltip
        side="bottom"
        content={tip}
        contentClassName="w-max"
        ariaLabel={
          !online && visualState === 'error' ? `${meta.ariaLabel} (offline)` : meta.ariaLabel
        }
        triggerClassName={`btn btn-ghost btn-sm btn-square ${meta.colorClass} ${triggerClassName}`}
        onTriggerClick={() => setLogOpen(true)}
      >
        <SyncSymbol state={visualState} />
      </InfoTooltip>
      <SyncLogView
        open={logOpen}
        onClose={() => setLogOpen(false)}
        online={online}
        storageMessage={storageMsg}
      />
    </>
  );
}

const STATE_META = {
  syncing: {
    colorClass: 'text-primary',
    ariaLabel: 'Syncing changes',
    tooltip: 'Saving local changes to the server…',
  },
  error: {
    colorClass: 'text-sync-attention',
    ariaLabel: 'Some changes failed to sync',
    tooltip: 'Sync needs attention — click for details',
  },
  synced: {
    colorClass: 'text-muted',
    ariaLabel: 'All changes saved',
    tooltip: 'All changes synced',
  },
  offline: {
    colorClass: 'text-muted',
    ariaLabel: 'Offline — changes saved on this device',
    tooltip: 'Saved on this device — changes will sync when reconnected',
  },
} as const;

/** The same etched orbit in every state; only the center and motion change. */
function SyncSymbol({ state }: { state: keyof typeof STATE_META }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className={state === 'syncing' ? 'sync-symbol-orbit' : undefined}>
        <path d="M4 9a8.3 8.3 0 0 1 14-3l2 2M20 3v5h-5M20 15A8.3 8.3 0 0 1 6 18l-2-2M4 21v-5h5" />
      </g>
      {state === 'error' ? (
        <path d="M12 8v5m0 3h.01" />
      ) : state === 'offline' ? (
        <path d="M10 9v6m4-6v6" />
      ) : (
        <path d="m12 8 3 4-3 4-3-4Z" />
      )}
    </svg>
  );
}
