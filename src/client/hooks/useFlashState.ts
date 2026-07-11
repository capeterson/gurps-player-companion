/**
 * Shared flash-animation state machine backing the `field-rollback-flash`
 * keyframe (AGENTS.md interaction rule 2 / offline-sync rule S5). Bundles
 * the flashing/parity state, the auto-clear timer, and — when a
 * `flashKey` is given — the flashBus subscription that re-triggers the
 * animation on an async rollback event.
 *
 * `useDraftField`, `useDraftToggle`, and `useFieldFlash` all used to carry
 * their own copy of this state machine (same FLASH_MS, same timer-ref /
 * mounted-ref / parity-toggle dance). This is the single source of truth
 * they now share; each hook still owns its own revert logic (what to
 * reset the draft/checked value to) and passes it in as `onBusEvent`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flashBus } from '../sync/flashBus.ts';

export const FLASH_MS = 1400;

export interface FlashDataProps {
  readonly 'data-flashing': 'true' | 'false';
  readonly 'data-flash-parity': '0' | '1';
}

export interface UseFlashStateReturn {
  /** True while the rollback flash keyframe is animating. */
  readonly flashing: boolean;
  /** Spread onto the element driving the `field-rollback-flash` keyframe. */
  readonly flashProps: FlashDataProps;
  /** Manually (re)start the flash animation — used for local (non-bus) rollbacks. */
  readonly trigger: () => void;
}

/**
 * @param flashKey Subscribe to the flashBus on this key; omit to disable
 *   the subscription (callers that only ever trigger manually).
 * @param onBusEvent Called (before the flash triggers) when a flashBus
 *   event arrives for `flashKey` — the hook's chance to revert its own
 *   local state to the last authoritative value.
 */
export function useFlashState(
  flashKey: string | undefined,
  onBusEvent?: () => void,
): UseFlashStateReturn {
  const [flashing, setFlashing] = useState(false);
  const [flashParity, setFlashParity] = useState<'0' | '1'>('0');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const onBusEventRef = useRef(onBusEvent);
  onBusEventRef.current = onBusEvent;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = useCallback(() => {
    setFlashing(true);
    // Parity alternates so back-to-back rejections re-trigger the
    // animation; without it the second event lands on the same
    // keyframe name and the browser ignores it.
    setFlashParity((p) => (p === '0' ? '1' : '0'));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setFlashing(false);
    }, FLASH_MS);
  }, []);

  useEffect(() => {
    if (!flashKey) return;
    return flashBus.subscribe(flashKey, () => {
      if (!mountedRef.current) return;
      onBusEventRef.current?.();
      trigger();
    });
  }, [flashKey, trigger]);

  return {
    flashing,
    flashProps: {
      'data-flashing': flashing ? 'true' : 'false',
      'data-flash-parity': flashParity,
    },
    trigger,
  };
}
