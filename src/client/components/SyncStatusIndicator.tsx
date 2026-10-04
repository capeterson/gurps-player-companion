/**
 * Toolbar sync indicator.
 *
 * Icon-only control with a DaisyUI tooltip that surfaces:
 *   - Current sync state (connected / synced / syncing / error / offline)
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
import { useState } from 'react';
import { useConnectionStatus } from '../hooks/useConnectionStatus.ts';
import { formatBytes, readLocalDbStatus } from '../lib/localDbStatus.ts';
import { isNetworkSyncLogEntry } from '../sync/syncLog.ts';
import { useSyncStatus } from '../sync/useSyncIndicatorState.ts';
import { useSyncWsStatus } from '../sync/useSyncWsStatus.ts';
import { SyncLogView } from './SyncLogView.tsx';
import { InfoTooltip } from './ui/InfoTooltip.tsx';

export function SyncStatusIndicator({ triggerClassName = '' }: { triggerClassName?: string } = {}) {
  const { state, error } = useSyncStatus();
  const websocket = useSyncWsStatus();
  const networkFailure = error && isNetworkSyncLogEntry({ result: 'failed', reason: error.reason });

  const { online, manualOffline } = useConnectionStatus();
  const [logOpen, setLogOpen] = useState(false);

  const storage = useQuery({
    queryKey: ['sync-indicator', 'storage'],
    queryFn: readLocalDbStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // A sync failure stays actionable when connectivity also drops.
  const visualState = manualOffline
    ? 'paused'
    : state === 'error' && !networkFailure
      ? 'error'
      : !online || networkFailure
        ? 'offline'
        : state === 'synced' && websocket.state === 'connected'
          ? 'connected'
          : state;
  const meta = STATE_META[visualState];

  // Build a single-line tooltip: state message · storage info
  const statusMsg =
    error && !manualOffline && !networkFailure
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
        <SyncSymbol state={visualState} connected={websocket.state === 'connected'} />
      </InfoTooltip>
      {/* Mounted only while open: the log's live queries scan the whole
          outbox and sync log, so keeping it mounted closed re-ran them on
          every local edit and pull. */}
      {logOpen && (
        <SyncLogView
          open
          onClose={() => setLogOpen(false)}
          online={online}
          storageMessage={storageMsg}
        />
      )}
    </>
  );
}

const STATE_META = {
  connected: {
    colorClass: 'text-muted',
    ariaLabel: 'All changes saved — live updates connected',
    tooltip: 'All changes synced · Live updates connected',
  },
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
  paused: {
    colorClass: 'text-muted',
    ariaLabel: 'Offline mode — sync paused',
    tooltip: 'Offline mode · Choose Go online to resume sync',
  },
} as const;

/** The same etched orbit in every state; only the center and motion change. */
function SyncSymbol({ state, connected }: { state: keyof typeof STATE_META; connected: boolean }) {
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
      ) : state === 'paused' ? (
        <path d="m8 16 8-8" />
      ) : (
        <path
          d="m12 8 3 4-3 4-3-4Z"
          className={connected ? 'text-success' : undefined}
          fill={connected ? 'currentColor' : 'none'}
        />
      )}
    </svg>
  );
}
