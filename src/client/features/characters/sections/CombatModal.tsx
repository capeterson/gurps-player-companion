/**
 * Combat modal — the prototype's bottom-right FAB target.
 * Edits flow through the local Dexie outbox (same path as the in-sheet
 * CombatPanel): each bumper / chip toggle calls `enqueueFieldPatch`
 * via useCombatPatch, which the orchestrator drains to the server.
 * Posture/conditions toggles update live; HP damage triggers the
 * `flash` keyframe and the `num-tween` pop on the big HP number.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { POSTURES } from '../../../../shared/constants/combat.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { Bumper } from '../../../components/ui/Bumper.tsx';
import { ConditionChip } from '../../../components/ui/ConditionChip.tsx';
import { OverflowBadge } from '../../../components/ui/OverflowBadge.tsx';
import { PoolMeter } from '../../../components/ui/PoolMeter.tsx';
import { hpVarFor } from './hpColor.ts';
import { useCombatPatch } from './useCombatPatch.ts';
import { usePoolBumpers } from './usePoolBumpers.ts';

const CONDITIONS = ['Stunned', 'Shock', 'Bleeding', 'Grappled', 'Reeling', 'Unconscious'] as const;

interface CombatModalProps {
  character: CharacterDetail;
  canWrite: boolean;
  onClose: () => void;
}

export function CombatModal({ character, canWrite, onClose }: CombatModalProps) {
  const combat = character.combat;
  const posture = combat?.posture ?? 'standing';
  const conditions = combat?.conditions ?? [];
  const navigate = useNavigate();

  const patchCombat = useCombatPatch(character);
  const { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp, flashHp } = usePoolBumpers(
    character,
    canWrite,
    patchCombat,
  );

  // Close on Escape — mirrors any standard modal behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setPosture(p: (typeof POSTURES)[number]) {
    if (!canWrite) return;
    void patchCombat('posture', p);
  }

  function toggleCondition(c: string) {
    if (!canWrite) return;
    const next = conditions.includes(c)
      ? conditions.filter((x: string) => x !== c)
      : [...conditions, c];
    void patchCombat('conditions', next);
  }

  const hpRatio = hpMax > 0 ? hp / hpMax : 0;
  const fpRatio = fpMax > 0 ? fp / fpMax : 0;
  const hpColor = hpVarFor(hpRatio);
  const fpColor = hpVarFor(fpRatio);

  return (
    <div
      className="modal-back"
      // biome-ignore lint/a11y/useSemanticElements: a fixed positioned <dialog> with showModal()
      // is a heavier lift; this aria-roled div is functionally equivalent and the Escape key
      // is wired up via a global keydown listener above.
      role="dialog"
      aria-modal="true"
      aria-label="Combat tracker"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div
        className="card relative w-[24rem] max-w-[calc(100vw-3rem)] max-h-[calc(100vh-3rem)] overflow-auto p-5 shadow-arcane-lg"
        style={{ background: 'var(--color-base-100)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="label-eyebrow">Combat</p>
            <h2 className="font-display text-2xl font-semibold">{character.name}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                onClose();
                navigate(`/characters/${character.id}/play`);
              }}
            >
              Open Play Mode
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className={`card mb-3 p-4 ${flashHp ? 'flash' : ''}`}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="label-eyebrow">Hit Points</span>
              {hp > hpMax && <OverflowBadge amount={hp - hpMax} />}
            </span>
            <span className="num text-xs text-dim">
              {/* Reeling starts when HP drops BELOW ⅓ of max (B419), so the
                  highest reeling value is ceil(max/3) − 1. */}
              max {hpMax} · reeling at {Math.ceil(hpMax / 3) - 1}
            </span>
          </div>
          <div className="mb-3 flex items-baseline gap-1.5">
            <span
              className={`num font-bold leading-none ${flashHp ? 'num-tween' : ''}`}
              style={{ fontSize: '4.5rem', color: hpColor, letterSpacing: '-0.03em' }}
            >
              {hp}
            </span>
            <span className="num text-2xl text-dim">/ {hpMax}</span>
          </div>
          <PoolMeter current={hp} max={hpMax} tone="hp" height="lg" ariaLabel="Hit points" />
          {canWrite && (
            <>
              <div className="mt-3 flex gap-1.5">
                <Bumper tone="dmg" onClick={() => bumpHp(-5)} ariaLabel="HP -5">
                  −5
                </Bumper>
                <Bumper tone="dmg" onClick={() => bumpHp(-1)} ariaLabel="HP -1">
                  −1
                </Bumper>
                <Bumper tone="heal" onClick={() => bumpHp(+1)} ariaLabel="HP +1">
                  +1
                </Bumper>
                <Bumper tone="heal" onClick={() => bumpHp(+5)} ariaLabel="HP +5">
                  +5
                </Bumper>
              </div>
              <button
                type="button"
                className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
                onClick={resetHp}
              >
                Reset to {hpMax}
              </button>
            </>
          )}
        </div>

        <div className="card mb-3 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="label-eyebrow">Fatigue</span>
              {fp > fpMax && <OverflowBadge amount={fp - fpMax} />}
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className="num font-bold leading-none"
                style={{ fontSize: '2rem', color: fpColor }}
              >
                {fp}
              </span>
              <span className="num text-sm text-dim">/ {fpMax}</span>
            </div>
          </div>
          <PoolMeter current={fp} max={fpMax} tone="fp" height="md" ariaLabel="Fatigue points" />
          {canWrite && (
            <>
              <div className="mt-2.5 flex gap-1.5">
                <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-5)}>
                  −5
                </button>
                <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(-1)}>
                  −1
                </button>
                <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+1)}>
                  +1
                </button>
                <button type="button" className="btn btn-sm flex-1" onClick={() => bumpFp(+5)}>
                  +5
                </button>
              </div>
              {fp !== fpMax && (
                <button
                  type="button"
                  className="mt-2 w-full rounded-field border border-dashed border-border-strong py-1.5 text-xs text-muted transition hover:bg-base-200"
                  onClick={resetFp}
                >
                  Reset to {fpMax}
                </button>
              )}
            </>
          )}
        </div>

        <div className="card mb-3 p-3">
          <p className="label-eyebrow mb-2">Posture</p>
          <div className="flex flex-wrap gap-1">
            {POSTURES.map((p) => (
              <ConditionChip
                key={p}
                label={p}
                active={posture === p}
                onClick={() => setPosture(p)}
                disabled={!canWrite}
                className="capitalize"
              />
            ))}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-eyebrow">Conditions</span>
            <span className="num text-[10px] text-dim">{conditions.length} active</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => (
              <ConditionChip
                key={c}
                label={c}
                active={conditions.includes(c)}
                onClick={() => toggleCondition(c)}
                disabled={!canWrite}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
