import { useSyncExternalStore } from 'react';
import { getSyncWsSubscriber } from './wsSubscriber.ts';

const subscribe = (listener: () => void) => getSyncWsSubscriber().subscribe(listener);
const getSnapshot = () => getSyncWsSubscriber().status;

/** Observes socket diagnostics without starting or controlling a connection. */
export function useSyncWsStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
