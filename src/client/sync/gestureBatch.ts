import { newBatchId } from './outbox.ts';

/**
 * Identify an explicit burst at the control, before any asynchronous storage
 * work. This does not delay writes or infer gestures from journal timestamps.
 * Changing control, account, character, clock direction, or exceeding the
 * existing debounce window starts a different burst.
 */
export function createGestureBatcher(windowMs: number, createId: () => string = newBatchId) {
  let active: { identity: string; scope: string; id: string; lastAt: number } | undefined;
  return {
    next(identity: string, scope: string, at: number, separateGesture = false): string {
      if (separateGesture) {
        active = undefined;
        return createId();
      }
      if (
        !active ||
        active.identity !== identity ||
        active.scope !== scope ||
        at < active.lastAt ||
        at - active.lastAt >= windowMs
      ) {
        active = { identity, scope, id: createId(), lastAt: at };
      } else {
        active.lastAt = at;
      }
      return active.id;
    },
  };
}
