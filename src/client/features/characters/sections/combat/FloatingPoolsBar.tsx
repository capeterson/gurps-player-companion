import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { conditionsInclude } from '../../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { hpVarFor } from '../hpColor.ts';
import type { PoolBumpers, PoolDeltaGesture } from '../usePoolBumpers.ts';

export const POOL_DELTA_DEBOUNCE_MS = 200;

function sumPoolDeltas(gestures: readonly PoolDeltaGesture[]): number {
  return gestures.reduce((total, gesture) => total + gesture.delta, 0);
}

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

/** Match a caption to the range thumb's numeric position, including uneven thresholds. */
export function rangePointPercent(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 0;
  return Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100));
}

interface PoolTriggerProps {
  label: 'HP' | 'FP';
  current: number;
  max: number;
  flashProps: ReturnType<typeof useFlashState>['flashProps'];
  open: boolean;
  panelId: string;
  onToggle: () => void;
}

function PoolTrigger({
  label,
  current,
  max,
  flashProps,
  open,
  panelId,
  onToggle,
}: PoolTriggerProps) {
  return (
    <button
      type="button"
      {...flashProps}
      className="field-rollback-flash btn btn-sm gap-1 px-2.5"
      aria-label={`Adjust ${label}`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span className="font-semibold">{label}</span>
      <span className="num text-base">{current}</span>
      <span className="num text-xs text-base-content/60">/ {max}</span>
      <span aria-hidden="true" className="text-[10px] text-base-content/50">
        ▾
      </span>
    </button>
  );
}

interface PoolAdjustmentPanelProps {
  id: string;
  label: 'HP' | 'FP';
  current: number;
  max: number;
  canWrite: boolean;
  points: readonly RangePoint[];
  recovery: string;
  footnote: string;
  onDeltas: (gestures: readonly PoolDeltaGesture[]) => Promise<number | undefined>;
  panelTop: number;
}

function PoolAdjustmentPanel({
  id,
  label,
  current,
  max,
  canWrite,
  points,
  recovery,
  footnote,
  onDeltas,
  panelTop,
}: PoolAdjustmentPanelProps) {
  const listId = useId();
  const lastValue = useRef(current);
  const currentValue = useRef(current);
  const pending = useRef<PoolDeltaGesture[]>([]);
  const outstanding = useRef<PoolDeltaGesture[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const confirmed = useRef<number | null>(null);
  const submitted = useRef<
    Array<{
      batch: readonly PoolDeltaGesture[];
      expected: number;
      observed: boolean;
    }>
  >([]);
  const onDeltasRef = useRef(onDeltas);
  const commitChain = useRef(Promise.resolve());
  const flushRef = useRef<() => void>(() => undefined);
  const [displayValue, setDisplayValue] = useState(current);

  onDeltasRef.current = onDeltas;

  function settle(batch: readonly PoolDeltaGesture[], value: number | undefined) {
    const settledIndex = submitted.current.findIndex((entry) => entry.batch === batch);
    const settledEntry = submitted.current[settledIndex];
    if (value !== undefined && settledEntry) {
      const shift = value - settledEntry.expected;
      for (let index = settledIndex + 1; index < submitted.current.length; index += 1) {
        const entry = submitted.current[index];
        if (entry && !entry.observed) entry.expected += shift;
      }
    }
    submitted.current = submitted.current.filter((entry) => entry.batch !== batch);
    const batchSet = new Set(batch);
    outstanding.current = outstanding.current.filter((gesture) => !batchSet.has(gesture));
    const base = value ?? currentValue.current;
    confirmed.current = value ?? null;
    const projected = base + sumPoolDeltas(outstanding.current);
    lastValue.current = projected;
    if (mounted.current) setDisplayValue(projected);
  }

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current.length === 0) return;
    const batch = pending.current;
    pending.current = [];
    submitted.current.push({ batch, expected: lastValue.current, observed: false });
    commitChain.current = commitChain.current
      .catch(() => undefined)
      .then(async () => {
        let value: number | undefined;
        try {
          value = await onDeltasRef.current(batch);
        } catch {
          // The pool helper normally surfaces its own toast/flash. Treat an
          // unexpected callback rejection as an uncommitted burst too.
          value = undefined;
        } finally {
          settle(batch, value);
        }
      });
  }
  flushRef.current = flush;

  function queueDelta(delta: number) {
    if (!canWrite || delta === 0) return;
    const gesture = { delta, at: Date.now() };
    pending.current.push(gesture);
    outstanding.current.push(gesture);
    lastValue.current += delta;
    setDisplayValue(lastValue.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, POOL_DELTA_DEBOUNCE_MS);
  }

  useEffect(() => {
    const previous = currentValue.current;
    currentValue.current = current;
    const acknowledgedIndex = submitted.current.findIndex(
      (entry) => !entry.observed && Object.is(entry.expected, current),
    );
    if (acknowledgedIndex >= 0) {
      for (let index = 0; index <= acknowledgedIndex; index += 1) {
        const entry = submitted.current[index];
        if (entry) entry.observed = true;
      }
      const acknowledged = new Set(
        submitted.current.filter((entry) => entry.observed).flatMap((entry) => [...entry.batch]),
      );
      const projected =
        current +
        outstanding.current.reduce(
          (total, gesture) => total + (acknowledged.has(gesture) ? 0 : gesture.delta),
          0,
        );
      lastValue.current = projected;
      setDisplayValue(projected);
      return;
    }
    if (confirmed.current !== null && Object.is(confirmed.current, current)) {
      confirmed.current = null;
      const projected = current + sumPoolDeltas(outstanding.current);
      lastValue.current = projected;
      setDisplayValue(projected);
      return;
    }
    confirmed.current = null;
    const shift = current - previous;
    for (const entry of submitted.current) {
      if (!entry.observed) entry.expected += shift;
    }
    const rebased = lastValue.current + shift;
    lastValue.current = rebased;
    setDisplayValue(rebased);
  }, [current]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Closing or switching the tooltip must not discard the tail of a burst.
      flushRef.current();
      mounted.current = false;
    };
  }, []);

  const minimum = -max;
  const sliderValue = Math.max(minimum, Math.min(max, displayValue));
  const panelStyle = { '--pool-panel-top': `${panelTop}px` } as CSSProperties;

  function adjustBy(delta: number) {
    queueDelta(delta);
  }

  return (
    <fieldset
      id={id}
      aria-label={`${label} adjustment`}
      style={panelStyle}
      className="dropdown-content fixed! left-1/2! right-auto! top-[var(--pool-panel-top)]! z-50 max-h-[calc(100dvh_-_var(--pool-panel-top)_-_1rem)] w-[calc(100dvw_-_2rem)] max-w-lg -translate-x-1/2 overflow-y-auto overscroll-contain rounded-box border border-base-300 bg-base-100 p-4 shadow-arcane-lg lg:absolute! lg:left-0! lg:right-auto! lg:top-full! lg:mt-[9px] lg:w-[32rem] lg:max-w-[calc(100dvw_-_2rem)] lg:translate-x-0"
    >
      <div className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{label === 'HP' ? 'Hit Points' : 'Fatigue Points'}</p>
            <p className="text-xs text-base-content/60">
              {canWrite ? 'Drag or use −1/+1.' : 'Current value and thresholds.'}
            </p>
          </div>
          {!canWrite && <strong className="num text-xl">{displayValue}</strong>}
        </div>
        {canWrite && (
          <div
            className="join mt-3 grid w-full grid-cols-[minmax(2.75rem,1fr)_auto_minmax(2.75rem,1fr)]"
            aria-label={`${label} step controls`}
          >
            <button
              type="button"
              className="btn btn-sm join-item min-h-11 w-full px-2"
              aria-label={`Decrease ${label} by 1`}
              onClick={() => adjustBy(-1)}
            >
              −1
            </button>
            <output
              aria-label={`Current ${label}`}
              className="join-item num flex min-h-11 min-w-20 items-center justify-center border-y border-base-300 bg-base-200 px-3 text-xl font-bold"
            >
              {displayValue}
            </output>
            <button
              type="button"
              className="btn btn-sm join-item min-h-11 w-full px-2"
              aria-label={`Increase ${label} by 1`}
              onClick={() => adjustBy(1)}
            >
              +1
            </button>
          </div>
        )}
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
          queueDelta(delta);
        }}
      />
      <datalist id={listId}>
        {points.map((point) => (
          <option key={`${point.value}:${point.label}`} value={point.value} label={point.label} />
        ))}
      </datalist>
      <div
        aria-hidden="true"
        className="relative h-16 text-base-content/40"
        style={{ marginInline: 'calc(var(--size-selector, 0.25rem) * 2.5)' }}
      >
        {points.map((point, index) => {
          const percent = rangePointPercent(point.value, minimum, max);
          const anchor = percent === 0 ? 'start' : percent === 100 ? 'end' : 'center';
          const alignment =
            anchor === 'start'
              ? 'translate-x-0 text-left'
              : anchor === 'end'
                ? '-translate-x-full text-right'
                : '-translate-x-1/2 text-center';
          return (
            <div key={`${point.value}:${point.label}`}>
              <span
                data-range-point={point.value}
                className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-current"
                style={{ left: `${percent}%` }}
              />
              <span
                data-range-label={point.value}
                data-range-anchor={anchor}
                className={`absolute ${index % 2 === 0 ? 'top-2' : 'top-9'} ${alignment} whitespace-nowrap text-[10px] leading-tight text-base-content/60`}
                style={{ left: `${percent}%` }}
              >
                <span className="num block font-semibold text-base-content/80">{point.value}</span>
                <span>{point.label}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-base-content/70">{recovery}</p>
      <p className="mt-1 text-[10px] text-base-content/45">{footnote}</p>
    </fieldset>
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
  const [openPool, setOpenPool] = useState<'HP' | 'FP' | null>(null);
  const barRef = useRef<HTMLElement>(null);
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
  const panelId = useId();
  const activePool =
    openPool === 'HP'
      ? {
          label: 'HP' as const,
          current: bumpers.hp,
          max: bumpers.hpMax,
          points: hpPoints,
          recovery: 'Recovery: make one HT roll per day; success restores 1 HP (B424).',
          footnote: `Outside the slider: certain death is −${5 * bumpers.hpMax} HP. Exceptional survival rules may still apply.`,
          onDeltas: bumpers.commitHpDeltas,
        }
      : openPool === 'FP'
        ? {
            label: 'FP' as const,
            current: bumpers.fp,
            max: bumpers.fpMax,
            points: fpPoints,
            recovery: 'Recovery: normally regain 1 FP per 10 minutes of rest (B426).',
            footnote: `At −${bumpers.fpMax} FP, further fatigue loss is paid from HP instead.`,
            onDeltas: bumpers.commitFpDeltas,
          }
        : null;

  useEffect(() => {
    if (openPool === null) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenPool(null);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPool(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [openPool]);

  return (
    <aside
      ref={barRef}
      className="fixed inset-x-0 z-40 border-b border-base-300 bg-base-100/95 shadow-md"
      style={{ top }}
      aria-label="Current HP and FP"
    >
      <div className="mx-auto flex min-h-12 max-w-[80rem] items-center gap-2 px-4 py-2 sm:px-7">
        <span className="hidden text-xs font-medium text-base-content/60 sm:inline">Current</span>
        <div
          className={`dropdown dropdown-start ${openPool === 'HP' ? 'dropdown-open' : ''}`}
          style={{ color: hpColor }}
        >
          <PoolTrigger
            label="HP"
            current={bumpers.hp}
            max={bumpers.hpMax}
            flashProps={hpFlash.flashProps}
            open={openPool === 'HP'}
            panelId={panelId}
            onToggle={() => setOpenPool((current) => (current === 'HP' ? null : 'HP'))}
          />
          {activePool?.label === 'HP' && (
            <PoolAdjustmentPanel
              key={activePool.label}
              id={panelId}
              {...activePool}
              canWrite={canWrite}
              panelTop={top + 56}
            />
          )}
        </div>
        <div className={`dropdown dropdown-start ${openPool === 'FP' ? 'dropdown-open' : ''}`}>
          <PoolTrigger
            label="FP"
            current={bumpers.fp}
            max={bumpers.fpMax}
            flashProps={fpFlash.flashProps}
            open={openPool === 'FP'}
            panelId={panelId}
            onToggle={() => setOpenPool((current) => (current === 'FP' ? null : 'FP'))}
          />
          {activePool?.label === 'FP' && (
            <PoolAdjustmentPanel
              key={activePool.label}
              id={panelId}
              {...activePool}
              canWrite={canWrite}
              panelTop={top + 56}
            />
          )}
        </div>
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
