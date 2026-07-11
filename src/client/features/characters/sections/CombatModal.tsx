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
import { COMMON_CONDITIONS, POSTURES } from '../../../../shared/constants/combat.ts';
import { conditionLabel, conditionsInclude } from '../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { Bumper } from '../../../components/ui/Bumper.tsx';
import { ConditionChip } from '../../../components/ui/ConditionChip.tsx';
import { OverflowBadge } from '../../../components/ui/OverflowBadge.tsx';
import { PoolMeter } from '../../../components/ui/PoolMeter.tsx';
import { hpVarFor } from './hpColor.ts';
import { useCombatPatch } from './useCombatPatch.ts';
import { useConditionsToggle } from './useConditionsToggle.ts';
import { usePoolBumpers } from './usePoolBumpers.ts';

interface CombatModalProps {
  character: CharacterDetail;
  canWrite: boolean;
  onClose: () => void;
}

export function CombatModal({ character, canWrite, onClose }: CombatModalProps) {
  const combat = character.combat;
  const posture = combat?.posture ?? 'standing';
  const navigate = useNavigate();

  const patchCombat = useCombatPatch(character);
  const { hp, fp, hpMax, fpMax, bumpHp, bumpFp, resetHp, resetFp, flashHp } = usePoolBumpers(
    character,
    canWrite,
    patchCombat,
  );
  const { conditions, toggle } = useConditionsToggle(character, canWrite, patchCombat);

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

  const hpRatio = hpMax > 0 ? hp / hpMax : 0;
  const fpRatio = fpMax > 0 ? fp / fpMax : 0;
  const hpColor = hpVarFor(hpRatio);
  const fpColor = hpVarFor(fpRatio);
  // Reeling starts when HP drops BELOW 1/3 of max (B419), so the
  // highest reeling value is ceil(max/3) - 1 — same convention as PoolsCard.
  const reelingThreshold = Math.ceil(hpMax / 3) - 1;
  const reelingSuggested =
    canWrite && hpMax > 0 && hp < Math.ceil(hpMax / 3) && !conditionsInclude(conditions, 'reeling');

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
              max {hpMax} · reeling at {reelingThreshold} · death checks from −{hpMax} (B419/B423)
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
          <p className="num mt-2 text-[11px] text-dim">
            at −{fpMax} further FP costs come off HP instead (B426)
          </p>
          {fp === -fpMax && (
            <p className="mt-1 text-[11px] text-warning">
              FP floor reached — further fatigue costs 1 HP per FP (B426)
            </p>
          )}
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
            {COMMON_CONDITIONS.map((id) => {
              const active = conditionsInclude(conditions, id);
              const suggest = id === 'reeling' && reelingSuggested && !active;
              return (
                <ConditionChip
                  key={id}
                  label={conditionLabel(id)}
                  active={active}
                  onClick={() => toggle(id)}
                  disabled={!canWrite}
                  className={suggest ? 'animate-pulse ring-2 ring-warning/70' : ''}
                />
              );
            })}
          </div>
          {reelingSuggested && (
            <p className="mt-1.5 text-[11px] text-warning">Reeling suggested — B419</p>
          )}
        </div>
      </div>
    </div>
  );
}
