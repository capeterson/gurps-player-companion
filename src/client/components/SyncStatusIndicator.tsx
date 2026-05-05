/**
 * Toolbar sync indicator -- the visual half of issue #12.
 *
 * Three states (mapped from `SyncStateStore`):
 *   - 'syncing'  spinning sync icon, "Saving…" tooltip
 *   - 'error'    warning triangle, "Some changes couldn't save" tooltip
 *   - 'synced'   checkmark, "All changes saved"
 *
 * Min-1-second visibility is enforced inside the store (see
 * src/client/sync/state.ts) so transient states are perceptible even
 * when the underlying sync resolves before the next repaint.
 *
 * Inline SVGs (no lucide-react / heroicons dep) keep the bundle slim.
 */

import { useSyncIndicatorState } from '../sync/useSyncIndicatorState.ts';

export function SyncStatusIndicator() {
  const state = useSyncIndicatorState();
  const meta = STATE_META[state];
  return (
    <output
      className={`badge ${meta.badgeClass} badge-sm gap-1`}
      aria-live="polite"
      aria-label={meta.ariaLabel}
      title={meta.tooltip}
    >
      {meta.icon}
      <span className="hidden sm:inline">{meta.label}</span>
    </output>
  );
}

const STATE_META = {
  syncing: {
    badgeClass: 'badge-info',
    label: 'Syncing',
    ariaLabel: 'Syncing changes',
    tooltip: 'Saving local changes to the server…',
    icon: <SpinnerIcon />,
  },
  error: {
    badgeClass: 'badge-warning',
    label: 'Sync failed',
    ariaLabel: 'Some changes failed to sync',
    tooltip: "Some changes couldn't sync — see toast for details",
    icon: <WarningIcon />,
  },
  synced: {
    badgeClass: 'badge-success',
    label: 'Synced',
    ariaLabel: 'All changes saved',
    tooltip: 'All changes saved',
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
