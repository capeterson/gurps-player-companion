/**
 * Toolbar sync indicator.
 *
 * Icon-only badge with a DaisyUI tooltip that surfaces:
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
import { useToasts } from '../lib/toast.tsx';
import { readUserIdFromToken } from '../lib/tokenStore.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';
import { useSyncIndicatorState } from '../sync/useSyncIndicatorState.ts';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';

export function SyncStatusIndicator() {
  const state = useSyncIndicatorState();
  const meta = STATE_META[state];
  const toasts = useToasts();

  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
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

  // Build a single-line tooltip: state message · storage info
  const statusMsg = !online ? '⚠ Offline — changes will sync when reconnected' : meta.tooltip;

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

  const badge = (
    <output
      className={`badge ${meta.badgeClass} badge-sm`}
      aria-live="polite"
      aria-label={online ? meta.ariaLabel : `${meta.ariaLabel} (offline)`}
    >
      {meta.icon}
    </output>
  );

  if (state !== 'error') {
    return (
      <span className="tooltip tooltip-bottom" data-tip={tip}>
        {badge}
      </span>
    );
  }

  const handleConfirmReset = async () => {
    const userId = readUserIdFromToken();
    if (!userId) {
      toasts.push("Couldn't resync — no authenticated user was found", { kind: 'error' });
      setConfirmOpen(false);
      return;
    }
    setResetting(true);
    try {
      await getSyncOrchestrator().clearLocalAndFullResync(userId);
      toasts.push('Local data cleared and resynced', { kind: 'success' });
      setConfirmOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'resync failed';
      toasts.push(`Couldn't resync — ${message}`, { kind: 'error' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <div className="dropdown dropdown-end">
        <button
          type="button"
          className="btn btn-ghost btn-xs min-h-0 px-1"
          aria-label={online ? meta.ariaLabel : `${meta.ariaLabel} (offline)`}
        >
          {badge}
        </button>
        <div
          role="tooltip"
          className="dropdown-content z-40 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-lg"
        >
          <p className="font-medium">Some changes couldn't sync.</p>
          <p className="mt-1 text-base-content/70">
            If sync is unrecoverably stuck, you can discard local pending edits and pull a fresh
            copy from the server.
          </p>
          {storageMsg && <p className="mt-2 text-xs text-base-content/60">{storageMsg}</p>}
          <button
            type="button"
            className="btn btn-warning btn-sm mt-3 w-full"
            disabled={resetting}
            onClick={() => setConfirmOpen(true)}
          >
            {resetting ? 'Resyncing…' : 'Clear local data and resync'}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Clear local data and resync?"
        confirmLabel={resetting ? 'Resyncing…' : 'Clear and resync'}
        cancelLabel="Keep local data"
        tone="error"
        onConfirm={() => {
          if (!resetting) void handleConfirmReset();
        }}
        onCancel={() => {
          if (!resetting) setConfirmOpen(false);
        }}
      >
        This will discard any pending offline edits stored on this device, clear local sync data,
        and download a fresh copy from the server.
      </ConfirmDialog>
    </>
  );
}

const STATE_META = {
  syncing: {
    badgeClass: 'badge-info',
    ariaLabel: 'Syncing changes',
    tooltip: 'Saving local changes to the server…',
    icon: <SpinnerIcon />,
  },
  error: {
    badgeClass: 'badge-warning',
    ariaLabel: 'Some changes failed to sync',
    tooltip: "⚠ Some changes couldn't sync — see toast for details",
    icon: <WarningIcon />,
  },
  synced: {
    badgeClass: 'badge-success',
    ariaLabel: 'All changes saved',
    tooltip: '✓ All changes saved',
    icon: <CheckIcon />,
  },
} as const;

function SpinnerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
