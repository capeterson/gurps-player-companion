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
 */

import { useEffect, useRef, useState } from 'react';
import { flashBus } from '../sync/flashBus.ts';

const FLASH_MS = 1400;

export interface UseFieldFlashReturn {
  readonly flashing: boolean;
  readonly 'data-flashing': 'true' | 'false';
  readonly 'data-flash-parity': '0' | '1';
}

export function useFieldFlash(flashKey: string | undefined): UseFieldFlashReturn {
  const [flashing, setFlashing] = useState(false);
  const [parity, setParity] = useState<'0' | '1'>('0');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!flashKey) return;
    return flashBus.subscribe(flashKey, () => {
      if (!mountedRef.current) return;
      setFlashing(true);
      // Parity alternates so back-to-back rejections re-trigger the
      // animation; without it the second event lands on the same
      // keyframe name and the browser ignores it.
      setParity((p) => (p === '0' ? '1' : '0'));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) setFlashing(false);
      }, FLASH_MS);
    });
  }, [flashKey]);

  return {
    flashing,
    'data-flashing': flashing ? 'true' : 'false',
    'data-flash-parity': parity,
  };
}
