/**
 * Subscribe to the flashBus on a single key and expose the data-*
 * props that drive the `field-rollback-flash` keyframe in theme.css.
 *
 * Why this hook exists separately from `useDraftField`: some editable
 * surfaces (the temp-modifier chip, future bulk-action triggers) skip
 * the draft-on-blur state machine and call the outbox directly. They
 * still need AGENTS.md rule 2's visual rollback signal when the
 * orchestrator rejects an op long after `onSave` resolved, but they
 * have no draft to revert. This hook covers the "flash only" half of
 * that contract — combine the returned props with `DRAFT_FIELD_CLASS`
 * on any element to make it pulse on rejection.
 *
 * The underlying flash/parity/timer state machine lives in
 * `useFlashState`, shared with `useDraftField` and `useDraftToggle`.
 */

import { useFlashState } from './useFlashState.ts';

export interface UseFieldFlashReturn {
  readonly flashing: boolean;
  readonly 'data-flashing': 'true' | 'false';
  readonly 'data-flash-parity': '0' | '1';
}

export function useFieldFlash(flashKey: string | undefined): UseFieldFlashReturn {
  const { flashing, flashProps } = useFlashState(flashKey);
  return { flashing, ...flashProps };
}
