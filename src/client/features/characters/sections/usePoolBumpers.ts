/**
 * HP/FP bumper state machine for the Combat tab. Owns the
 * latest-intended-value refs, the soft-cap "double-press to override"
 * state, the death-check-zone floors, and the damage flash — everything
 * except rendering.
 *
 * Patches flow through the `patchCombat` callback the caller provides
 * (see useCombatPatch), so this hook never talks to the outbox
 * directly.
 */

import { useEffect, useRef, useState } from 'react';
import { bumpPool } from '../../../../shared/domain/poolBump.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';

export interface PoolBumpers {
  readonly hp: number;
  readonly fp: number;
  readonly hpMax: number;
  readonly fpMax: number;
  readonly bumpHp: (d: number) => void;
  readonly bumpFp: (d: number) => void;
  readonly resetHp: () => void;
  readonly resetFp: () => void;
  readonly flashHp: boolean;
}

export function usePoolBumpers(
  character: CharacterDetail,
  canWrite: boolean,
  patchCombat: (field: string, value: unknown) => Promise<void>,
): PoolBumpers {
  const combat = character.combat;
  const hp = combat?.currentHp ?? character.derived.hp;
  const fp = combat?.currentFp ?? character.derived.fp;
  const hpMax = character.derived.hp;
  const fpMax = character.derived.fp;

  // Latest-intended values for HP/FP, updated synchronously on every
  // bumper tap. Without these refs, two taps that fire before React
  // commits a new `combat` prop would read the same render-time `hp`
  // and enqueue duplicate patches, dropping the second tap. The refs
  // resync from the prop whenever Dexie surfaces a new value.
  const hpRef = useRef(hp);
  const fpRef = useRef(fp);
  useEffect(() => {
    hpRef.current = hp;
  }, [hp]);
  useEffect(() => {
    fpRef.current = fp;
  }, [fp]);

  // Soft-cap "double-press to override" state for HP and FP. The
  // helper returns `lastBlockedAt` we feed back on the next call —
  // a second press within 2 s allows the overflow to land. See
  // src/shared/domain/poolBump.ts.
  const hpBlockedAtRef = useRef<number | null>(null);
  const fpBlockedAtRef = useRef<number | null>(null);

  const [flashHp, setFlashHp] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  function flashHpDamage() {
    setFlashHp(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashHp(false), 500);
  }

  function bumpHp(d: number) {
    if (!canWrite || hpMax <= 0) return;
    // Compose against the latest-intended value (hpRef), not the
    // render snapshot, so rapid same-frame taps each compound
    // instead of overwriting the prior tap.  bumpPool gives us the
    // soft-cap "double-press to override" rule for free; we still
    // clamp the lower bound at -5×max — automatic death is certain at
    // -5×HP (B419/B423), so the tracker has no reason to record HP
    // below that threshold.
    const result = bumpPool(hpRef.current, d, hpMax, hpBlockedAtRef.current);
    const next = Math.max(-hpMax * 5, result.next);
    hpBlockedAtRef.current = result.lastBlockedAt;
    if (next === hpRef.current) return; // pure block, no patch needed
    hpRef.current = next;
    void patchCombat('currentHp', next);
    if (d < 0) flashHpDamage();
  }

  function bumpFp(d: number) {
    if (!canWrite || fpMax <= 0) return;
    const result = bumpPool(fpRef.current, d, fpMax, fpBlockedAtRef.current);
    const next = Math.max(-fpMax, result.next);
    const hpCost = Math.max(0, next - result.next);
    fpBlockedAtRef.current = result.lastBlockedAt;
    if (next !== fpRef.current) {
      fpRef.current = next;
      void patchCombat('currentFp', next);
    }

    // Once FP reaches -FP, further fatigue costs HP one-for-one (B426).
    // Apply overflow from a decrement that crosses the floor as well as
    // subsequent decrements made while already at the floor.
    if (hpCost > 0) {
      const nextHp = Math.max(-hpMax * 5, hpRef.current - hpCost);
      if (nextHp !== hpRef.current) {
        hpRef.current = nextHp;
        void patchCombat('currentHp', nextHp);
        flashHpDamage();
      }
    }
  }

  // Resets update the ref *first* (same as the bumpers) so a bump that
  // races the reset composes against the reset value, not a stale one.
  function resetHp() {
    hpRef.current = hpMax;
    void patchCombat('currentHp', hpMax);
  }

  function resetFp() {
    fpRef.current = fpMax;
    void patchCombat('currentFp', fpMax);
  }

  return { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp, flashHp };
}
