/** HP/FP gestures compose against the latest local row through useCombatPatch. */
import { useEffect, useRef, useState } from 'react';
import { applyFatigueLoss } from '../../../../shared/domain/fatigue.ts';
import { bumpPool } from '../../../../shared/domain/poolBump.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { useToasts } from '../../../lib/toast.tsx';
import { flashBus, makeFlashKey } from '../../../sync/flashBus.ts';
import type { CombatPatch, CombatUpdate } from './useCombatPatch.ts';

export interface PoolBumpers {
  readonly hp: number;
  readonly fp: number;
  readonly hpMax: number;
  readonly fpMax: number;
  readonly bumpHp: (d: number) => void;
  readonly bumpFp: (d: number) => void;
  readonly commitHpDeltas: (gestures: readonly PoolDeltaGesture[]) => Promise<number | undefined>;
  readonly commitFpDeltas: (gestures: readonly PoolDeltaGesture[]) => Promise<number | undefined>;
  readonly resetHp: () => void;
  readonly resetFp: () => void;
  readonly flashHp: boolean;
}

/** A relative pool gesture keeps its interaction time for the soft-cap override window. */
export interface PoolDeltaGesture {
  readonly delta: number;
  readonly at: number;
}

export function usePoolBumpers(
  character: CharacterDetail,
  canWrite: boolean,
  patchCombat: CombatPatch,
): PoolBumpers {
  const toasts = useToasts();
  const hp = character.combat?.currentHp ?? character.derived.hp;
  const fp = character.combat?.currentFp ?? character.derived.fp;
  const hpMax = character.derived.hp;
  const fpMax = character.derived.fp;
  const hpBlockedAtRef = useRef<number | null>(null);
  const fpBlockedAtRef = useRef<number | null>(null);
  const [flashHp, setFlashHp] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  async function commit(update: CombatUpdate, affected: string[]): Promise<boolean> {
    let keys = affected;
    let hpDamage = false;
    try {
      await patchCombat((current) => {
        const fields = update(current);
        keys = Object.keys(fields);
        hpDamage = typeof fields.currentHp === 'number' && fields.currentHp < current.currentHp;
        return fields;
      });
      if (hpDamage) {
        setFlashHp(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashHp(false), 500);
      }
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toasts.push(
        `Couldn't save ${keys.map((key) => (key === 'currentHp' ? 'HP' : 'FP')).join(' and ')} — ${reason}`,
        { kind: 'error' },
      );
      for (const key of keys) {
        // A failed local gesture did not reject another input's newer draft.
        flashBus.emit({
          key: makeFlashKey('character_combat', character.id, key),
          reason,
          visualOnly: true,
        });
      }
      return false;
    }
  }

  async function commitHpDeltas(
    gestures: readonly PoolDeltaGesture[],
  ): Promise<number | undefined> {
    if (!canWrite || hpMax <= 0 || gestures.length === 0) return undefined;
    let committed: number | undefined;
    let nextBlockedAt: number | null = null;
    let savedBlockedAt: number | null | undefined;
    const saved = await commit(
      (current) => {
        savedBlockedAt = hpBlockedAtRef.current;
        nextBlockedAt = savedBlockedAt;
        let next = current.currentHp;
        for (const gesture of gestures) {
          const result = bumpPool(next, gesture.delta, hpMax, nextBlockedAt, gesture.at);
          nextBlockedAt = result.lastBlockedAt;
          next = Math.max(-hpMax * 5, result.next);
        }
        // Set this inside the serialized transaction so a second queued commit
        // observes the first burst's soft-cap state even before its promise settles.
        hpBlockedAtRef.current = nextBlockedAt;
        committed = next;
        return next === current.currentHp ? {} : { currentHp: next };
      },
      ['currentHp'],
    );
    if (!saved) {
      if (hpBlockedAtRef.current === nextBlockedAt && savedBlockedAt !== undefined) {
        hpBlockedAtRef.current = savedBlockedAt;
      }
      return undefined;
    }
    return committed;
  }

  async function commitFpDeltas(
    gestures: readonly PoolDeltaGesture[],
  ): Promise<number | undefined> {
    if (!canWrite || fpMax <= 0 || gestures.length === 0) return undefined;
    let committed: number | undefined;
    let nextBlockedAt: number | null = null;
    let savedBlockedAt: number | null | undefined;
    const saved = await commit(
      (current) => {
        savedBlockedAt = fpBlockedAtRef.current;
        nextBlockedAt = savedBlockedAt;
        let nextFp = current.currentFp;
        let nextHp = current.currentHp;
        for (const gesture of gestures) {
          const result = bumpPool(nextFp, gesture.delta, fpMax, nextBlockedAt, gesture.at);
          nextBlockedAt = result.lastBlockedAt;
          if (gesture.delta < 0) {
            const fatigue = applyFatigueLoss(nextFp, -gesture.delta, fpMax);
            nextFp = fatigue.fp;
            if (fatigue.hpCost > 0) {
              nextHp = Math.max(-hpMax * 5, nextHp - fatigue.hpCost);
            }
          } else {
            nextFp = result.next;
          }
        }
        fpBlockedAtRef.current = nextBlockedAt;
        committed = nextFp;
        const fields: Partial<Record<'currentHp' | 'currentFp', number>> = {};
        if (nextFp !== current.currentFp) fields.currentFp = nextFp;
        if (nextHp !== current.currentHp) fields.currentHp = nextHp;
        return fields;
      },
      gestures.some((gesture) => gesture.delta < 0) ? ['currentFp', 'currentHp'] : ['currentFp'],
    );
    if (!saved) {
      if (fpBlockedAtRef.current === nextBlockedAt && savedBlockedAt !== undefined) {
        fpBlockedAtRef.current = savedBlockedAt;
      }
      return undefined;
    }
    return committed;
  }

  function bumpHp(d: number) {
    void commitHpDeltas([{ delta: d, at: Date.now() }]);
  }

  function bumpFp(d: number) {
    void commitFpDeltas([{ delta: d, at: Date.now() }]);
  }

  function resetHp() {
    if (canWrite) void commit(() => ({ currentHp: hpMax }), ['currentHp']);
  }
  function resetFp() {
    if (canWrite) void commit(() => ({ currentFp: fpMax }), ['currentFp']);
  }

  return {
    hp,
    fp,
    hpMax,
    fpMax,
    bumpHp,
    bumpFp,
    commitHpDeltas,
    commitFpDeltas,
    resetHp,
    resetFp,
    flashHp,
  };
}
