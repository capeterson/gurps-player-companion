/**
 * React hook bound to the singleton SyncStateStore.
 *
 * Uses `useSyncExternalStore` so React 19's concurrent renderer can't
 * tear: every component sees the same value at every commit.
 */

import { useSyncExternalStore } from 'react';
import { type SyncIndicatorState, syncStateStore } from './state.ts';

function getSnapshot(): SyncIndicatorState {
  return syncStateStore.value;
}

function subscribe(cb: () => void): () => void {
  return syncStateStore.subscribe(cb);
}

export function useSyncIndicatorState(): SyncIndicatorState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
