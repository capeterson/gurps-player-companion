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
  readonly resetHp: () => void;
  readonly resetFp: () => void;
  readonly flashHp: boolean;
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

  function commit(update: CombatUpdate, affected: string[]) {
    let keys = affected;
    let hpDamage = false;
    void patchCombat((current) => {
      const fields = update(current);
      keys = Object.keys(fields);
      hpDamage = typeof fields.currentHp === 'number' && fields.currentHp < current.currentHp;
      return fields;
    })
      .then(() => {
        if (!hpDamage) return;
        setFlashHp(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashHp(false), 500);
      })
      .catch((err) => {
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
      });
  }

  function bumpHp(d: number) {
    if (!canWrite || hpMax <= 0) return;
    const now = Date.now();
    commit(
      (current) => {
        const result = bumpPool(current.currentHp, d, hpMax, hpBlockedAtRef.current, now);
        hpBlockedAtRef.current = result.lastBlockedAt;
        const next = Math.max(-hpMax * 5, result.next);
        return next === current.currentHp ? {} : { currentHp: next };
      },
      ['currentHp'],
    );
  }

  function bumpFp(d: number) {
    if (!canWrite || fpMax <= 0) return;
    const now = Date.now();
    commit(
      (current) => {
        const result = bumpPool(current.currentFp, d, fpMax, fpBlockedAtRef.current, now);
        fpBlockedAtRef.current = result.lastBlockedAt;
        const fatigue = applyFatigueLoss(current.currentFp, -d, fpMax);
        const next = d < 0 ? fatigue.fp : result.next;
        const fields: Partial<Record<'currentHp' | 'currentFp', number>> = {};
        if (next !== current.currentFp) fields.currentFp = next;
        if (d < 0 && fatigue.hpCost > 0) {
          const nextHp = Math.max(-hpMax * 5, current.currentHp - fatigue.hpCost);
          if (nextHp !== current.currentHp) fields.currentHp = nextHp;
        }
        return fields;
      },
      d < 0 ? ['currentFp', 'currentHp'] : ['currentFp'],
    );
  }

  function resetHp() {
    if (canWrite) commit(() => ({ currentHp: hpMax }), ['currentHp']);
  }
  function resetFp() {
    if (canWrite) commit(() => ({ currentFp: fpMax }), ['currentFp']);
  }

  return { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp, flashHp };
}
