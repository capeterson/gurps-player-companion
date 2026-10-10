import { useSyncExternalStore } from 'react';
import { connectionStore } from '../lib/connectionState.ts';

const getSnapshot = () => connectionStore.status;

export function useConnectionStatus() {
  return useSyncExternalStore(connectionStore.subscribe, getSnapshot, getSnapshot);
}
