/**
 * React hook bound to the singleton SyncStateStore.
 *
 * Uses `useSyncExternalStore` so React 19's concurrent renderer can't
 * tear: every component sees the same value at every commit.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { getLocalDb } from '../db/dexie.ts';
import { LEGACY_CAMPAIGN_HOLD_REASON } from '../db/legacyCampaignDependencies.ts';
import { type SyncIndicatorState, type SyncStatus, syncStateStore } from './state.ts';

function getSnapshot(): SyncIndicatorState {
  return syncStateStore.value;
}

function getStatusSnapshot(): SyncStatus {
  return syncStateStore.status;
}

function subscribe(cb: () => void): () => void {
  return syncStateStore.subscribe(cb);
}

export function useSyncIndicatorState(): SyncIndicatorState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** State plus the reason for an `error`, for the badge tooltip + sync log. */
export function useSyncStatus(): SyncStatus {
  const status = useSyncExternalStore(subscribe, getStatusSnapshot, getStatusSnapshot);
  const held = useLiveQuery(
    () =>
      getLocalDb()
        .outbox.filter((op) => op.localCampaignDependencyUnknown === true)
        .first(),
    [],
  );
  return held
    ? { state: 'error', error: { reason: LEGACY_CAMPAIGN_HOLD_REASON, at: held.enqueuedAt } }
    : status;
}
