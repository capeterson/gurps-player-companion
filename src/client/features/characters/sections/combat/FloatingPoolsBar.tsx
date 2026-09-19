import { useEffect, useId, useRef, useState } from 'react';
import { conditionsInclude } from '../../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { hpVarFor } from '../hpColor.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';

interface FloatingPoolsBarProps {
  character: CharacterDetail;
  bumpers: PoolBumpers;
  canWrite: boolean;
  top?: number;
}

interface RangePoint {
  value: number;
  label: string;
}

interface PoolRangeProps {
  label: 'HP' | 'FP';
  current: number;
  max: number;
  canWrite: boolean;
  points: readonly RangePoint[];
  recovery: string;
  footnote: string;
  onDelta: (delta: number) => void;
  flashProps: ReturnType<typeof useFlashState>['flashProps'];
}

function PoolRange({
  label,
  current,
  max,
  canWrite,
  points,
  recovery,
  footnote,
  onDelta,
  flashProps,
}: PoolRangeProps) {
  const listId = useId();
  const lastValue = useRef(current);
  const [displayValue, setDisplayValue] = useState(current);

  useEffect(() => {
    lastValue.current = current;
    setDisplayValue(current);
  }, [current]);

  const minimum = -max;
  const sliderValue = Math.max(minimum, Math.min(max, displayValue));

  return (
    <details className={`dropdown ${label === 'HP' ? 'dropdown-start' : 'dropdown-end'}`}>
      <summary
        {...flashProps}
        className="field-rollback-flash btn btn-sm list-none gap-1 px-2.5"
        aria-label={`Adjust ${label}`}
      >
        <span className="font-semibold">{label}</span>
        <span className="num text-base">{current}</span>
        <span className="num text-xs text-base-content/60">/ {max}</span>
        <span aria-hidden="true" className="text-[10px] text-base-content/50">
          ▾
        </span>
      </summary>
      <div className="dropdown-content z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-4 shadow-arcane-lg">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <p className="font-semibold">{label === 'HP' ? 'Hit Points' : 'Fatigue Points'}</p>
            <p className="text-xs text-base-content/60">
              {canWrite ? 'Drag to set the current value.' : 'Current value and thresholds.'}
            </p>
          </div>
          <strong className="num text-xl">{displayValue}</strong>
        </div>
        <input
          type="range"
          min={minimum}
          max={max}
          step={1}
          list={listId}
          value={sliderValue}
          disabled={!canWrite}
          aria-label={`Set ${label}`}
          className={`range range-sm w-full ${label === 'HP' ? 'range-error' : 'range-info'}`}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            const delta = next - lastValue.current;
            lastValue.current = next;
            setDisplayValue(next);
            if (delta !== 0) onDelta(delta);
          }}
        />
        <datalist id={listId}>
          {points.map((point) => (
            <option key={`${point.value}:${point.label}`} value={point.value} label={point.label} />
          ))}
        </datalist>
        <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] leading-tight text-base-content/60">
          {points.map((point) => (
            <span
              key={`${point.value}:${point.label}`}
              className="text-center first:text-left last:text-right"
            >
              <span className="num block font-semibold text-base-content/80">{point.value}</span>
              {point.label}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-base-content/70">{recovery}</p>
        <p className="mt-1 text-[10px] text-base-content/45">{footnote}</p>
      </div>
    </details>
  );
}

function poolStatuses(character: CharacterDetail, bumpers: PoolBumpers): string[] {
  const { hp, hpMax, fp, fpMax } = bumpers;
  const persisted = character.combat?.conditions ?? [];
  const statuses: string[] = [];
  if (hpMax > 0 && hp < Math.ceil(hpMax / 3)) statuses.push('Reeling');
  if (fpMax > 0 && fp < Math.ceil(fpMax / 3)) statuses.push('Tired');
  if (fpMax > 0 && fp <= 0) statuses.push('Exhausted');
  if (hp <= 0) statuses.push('Consciousness checks');
  if (hpMax > 0 && hp <= -hpMax) statuses.push('Death check');
  if (fpMax > 0 && fp <= -fpMax) statuses.push('Unconscious');
  if (conditionsInclude(persisted, 'unconscious') && !statuses.includes('Unconscious')) {
    statuses.push('Unconscious');
  }
  if (conditionsInclude(persisted, 'mortally_wounded')) statuses.push('Mortally wounded');
  if (hpMax > 0 && hp <= -5 * hpMax) statuses.push('Dead');
  return statuses;
}

export function FloatingPoolsBar({
  character,
  bumpers,
  canWrite,
  top = 64,
}: FloatingPoolsBarProps) {
  const hpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentHp'));
  const fpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentFp'));
  const statuses = poolStatuses(character, bumpers);
  const hpColor = hpVarFor(bumpers.hpMax > 0 ? bumpers.hp / bumpers.hpMax : 0);

  const hpPoints = [
    { value: -bumpers.hpMax, label: 'Death check' },
    { value: 0, label: 'Stay conscious' },
    { value: Math.ceil(bumpers.hpMax / 3), label: 'Reeling ends' },
    { value: bumpers.hpMax, label: 'Full' },
  ] as const;
  const fpPoints = [
    { value: -bumpers.fpMax, label: 'Unconscious' },
    { value: 0, label: 'Exhausted' },
    { value: Math.ceil(bumpers.fpMax / 3), label: 'Tired ends' },
    { value: bumpers.fpMax, label: 'Rested' },
  ] as const;

  return (
    <aside
      className="fixed inset-x-0 z-40 border-b border-base-300 bg-base-100/95 shadow-md backdrop-blur"
      style={{ top }}
      aria-label="Current HP and FP"
    >
      <div className="mx-auto flex min-h-12 max-w-[80rem] items-center gap-2 px-4 py-2 sm:px-7">
        <span className="hidden text-xs font-medium text-base-content/60 sm:inline">Current</span>
        <span style={{ color: hpColor }}>
          <PoolRange
            label="HP"
            current={bumpers.hp}
            max={bumpers.hpMax}
            canWrite={canWrite}
            points={hpPoints}
            recovery="Recovery: make one HT roll per day; success restores 1 HP (B424)."
            footnote={`Outside the slider: certain death is −${5 * bumpers.hpMax} HP. Exceptional survival rules may still apply.`}
            onDelta={bumpers.bumpHp}
            flashProps={hpFlash.flashProps}
          />
        </span>
        <PoolRange
          label="FP"
          current={bumpers.fp}
          max={bumpers.fpMax}
          canWrite={canWrite}
          points={fpPoints}
          recovery="Recovery: normally regain 1 FP per 10 minutes of rest (B426)."
          footnote={`At −${bumpers.fpMax} FP, further fatigue loss is paid from HP instead.`}
          onDelta={bumpers.bumpFp}
          flashProps={fpFlash.flashProps}
        />
        <div className="ml-auto flex min-w-0 gap-1 overflow-x-auto" aria-label="Pool conditions">
          {statuses.length === 0 ? (
            <span className="badge badge-ghost badge-sm whitespace-nowrap">Stable</span>
          ) : (
            statuses.map((status) => (
              <span
                key={status}
                className={`badge badge-sm whitespace-nowrap ${
                  status === 'Dead' || status === 'Unconscious'
                    ? 'badge-error'
                    : status === 'Reeling' || status === 'Tired'
                      ? 'badge-warning'
                      : 'badge-outline'
                }`}
              >
                {status}
              </span>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
