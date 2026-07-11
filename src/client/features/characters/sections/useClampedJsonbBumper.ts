/**
 * useClampedJsonbBumper — shared state machine behind the powerstone
 * "charge" and magic-item "charges" +/-/Max controls in
 * PowerstonesPanel.tsx.  Both rows patch a whole JSONB field as a
 * single unit (the field validator parses the entire object shape, so
 * a partial patch would fail validation) and both need the same
 * latest-intended-ref trick as the HP/FP bumpers
 * (`sections/usePoolBumpers.ts`): two rapid taps must compound against
 * the value the first tap already committed to, not the stale
 * render-time prop, or the second tap silently drops.
 */

import { useEffect, useRef } from 'react';
import { makeFlashKey } from '../../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../../sync/outbox.ts';

export interface UseClampedJsonbBumperOptions<T> {
  readonly characterId: string;
  /** The inventory item id this JSONB field lives on. */
  readonly entityId: string;
  /** Whole-object field being patched, e.g. 'powerstoneData'. */
  readonly fieldPath: string;
  readonly humanName: string;
  /** Current value of the clamped counter (e.g. currentEnergy / chargesCurrent). */
  readonly current: number;
  readonly max: number;
  readonly canWrite: boolean;
  /** Build the full JSONB value to patch, given the clamped counter. */
  readonly buildValue: (clamped: number) => T;
}

export interface UseClampedJsonbBumperReturn {
  /** Set the counter to an absolute value, clamped to [0, max]. */
  readonly setTo: (next: number) => void;
  /** Bump the counter by a relative delta, clamped to [0, max]. */
  readonly bump: (delta: number) => void;
}

export function useClampedJsonbBumper<T>({
  characterId,
  entityId,
  fieldPath,
  humanName,
  current,
  max,
  canWrite,
  buildValue,
}: UseClampedJsonbBumperOptions<T>): UseClampedJsonbBumperReturn {
  // Latest-intended ref. Without this, two rapid taps both read the
  // same render-time `current` and enqueue duplicate patches, dropping
  // one click. The ref is read directly on every render, which is safe
  // because Dexie's local-first writes mean the prop already reflects
  // the latest committed intent before the next synchronous click
  // handler runs.
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const setTo = (next: number) => {
    if (!canWrite) return;
    const clamped = Math.max(0, Math.min(max, Math.round(next)));
    if (clamped === currentRef.current) return;
    currentRef.current = clamped;
    void enqueueFieldPatch({
      entityClass: 'character_inventory',
      entityId,
      fieldPath,
      attemptedValue: buildValue(clamped),
      humanName,
      flashKey: makeFlashKey('character_inventory', entityId, fieldPath),
      characterId,
    });
  };
  const bump = (delta: number) => setTo(currentRef.current + delta);

  return { setTo, bump };
}
