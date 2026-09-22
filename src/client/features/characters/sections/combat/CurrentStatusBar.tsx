import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { COMMON_CONDITIONS, MANEUVERS, POSTURES } from '../../../../../shared/constants/combat.ts';
import { conditionLabel, conditionsInclude } from '../../../../../shared/domain/conditions.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { ConditionChip } from '../../../../components/ui/ConditionChip.tsx';
import { InfoTooltip } from '../../../../components/ui/InfoTooltip.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../../../hooks/useDraftField.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useViewportBoundedOverlay } from '../../../../hooks/useViewportBoundedOverlay.ts';
import { makeFlashKey } from '../../../../sync/flashBus.ts';
import { RollableRow } from '../RollableRow.tsx';
import { hpVarFor } from '../hpColor.ts';
import type { RollRequest } from '../rollTypes.ts';
import type { CombatPatch } from '../useCombatPatch.ts';
import { useConditionsToggle } from '../useConditionsToggle.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';

type StatusPanel = 'HP' | 'FP' | 'posture' | 'maneuver' | 'conditions';

interface CurrentStatusBarProps {
  character: CharacterDetail;
  bumpers: PoolBumpers;
  canWrite: boolean;
  patchCombat: CombatPatch;
  openRoll: (request: RollRequest) => void;
  top?: number;
  onHeightChange?: (height: number) => void;
}

interface RangePoint {
  value: number;
  label: string;
}

interface HpCheck {
  label: 'Stay conscious' | 'Death check';
  target: number;
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
  warning?: string | undefined;
  flashProps: ReturnType<typeof useFlashState>['flashProps'];
  open: boolean;
  panelId: string;
  onToggle: (trigger: HTMLButtonElement) => void;
}

function PoolTrigger({
  label,
  current,
  max,
  warning,
  flashProps,
  open,
  panelId,
  onToggle,
}: PoolTriggerProps) {
  return (
    <button
      type="button"
      {...flashProps}
      className="field-rollback-flash btn btn-sm min-h-10 w-full gap-1 px-2.5 md:w-auto"
      aria-label={`Adjust ${label}, current ${current} of ${max}${warning ? `, ${warning}` : ''}`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(event) => onToggle(event.currentTarget)}
    >
      <span className="font-semibold">{label}</span>
      <span className="num text-base">{current}</span>
      <span className="num text-xs text-base-content/60">/ {max}</span>
      {warning && (
        <span className="badge badge-warning badge-xs ml-1 max-w-24 truncate">{warning}</span>
      )}
      <span aria-hidden="true" className="text-[10px] text-base-content/50">
        {open ? '▴' : '▾'}
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
  onDelta: (delta: number) => void;
  onReset: () => void;
  onSetValue: (value: number) => void;
  panelTop: number;
  hpCheck?: HpCheck | undefined;
  openRoll: (request: RollRequest) => void;
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
  onDelta,
  onReset,
  onSetValue,
  panelTop,
  hpCheck,
  openRoll,
}: PoolAdjustmentPanelProps) {
  const listId = useId();
  const minimum = -max;
  const sliderValue = Math.max(minimum, Math.min(max, current));
  const panelStyle = { '--pool-panel-top': `${panelTop}px` } as CSSProperties;
  const panelRef = useViewportBoundedOverlay<HTMLFieldSetElement>();

  return (
    <fieldset
      ref={panelRef}
      id={id}
      aria-label={`${label} adjustment`}
      style={panelStyle}
      className="dropdown-content fixed! left-1/2! right-auto! top-[var(--pool-panel-top)]! z-50 max-h-[calc(100dvh_-_var(--pool-panel-top)_-_1rem)] w-[calc(100dvw_-_2rem)] max-w-lg translate-x-[calc(-50%+var(--viewport-overlay-shift-x,0px))] overflow-y-auto overscroll-contain rounded-box border border-base-300 bg-base-100 p-4 shadow-arcane-lg md:absolute! md:left-0! md:right-auto! md:top-full! md:mt-[9px] md:w-[32rem] md:max-w-[calc(100dvw_-_2rem)] md:translate-x-[var(--viewport-overlay-shift-x,0px)]"
    >
      <div className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{label === 'HP' ? 'Hit Points' : 'Fatigue Points'}</p>
            <p className="text-xs text-base-content/60">
              {canWrite ? 'Drag or use the quick adjustments.' : 'Current value and thresholds.'}
            </p>
          </div>
          {!canWrite && <strong className="num text-xl">{current}</strong>}
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
              onClick={() => onDelta(-1)}
            >
              −1
            </button>
            <output
              aria-label={`Current ${label}`}
              className="join-item num flex min-h-11 min-w-20 items-center justify-center border-y border-base-300 bg-base-200 px-3 text-xl font-bold"
            >
              {current}
            </output>
            <button
              type="button"
              className="btn btn-sm join-item min-h-11 w-full px-2"
              aria-label={`Increase ${label} by 1`}
              onClick={() => onDelta(1)}
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
        onChange={(event) => onSetValue(event.currentTarget.valueAsNumber)}
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
      {canWrite && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" className="btn btn-sm" onClick={() => onDelta(-5)}>
            −5 {label}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onDelta(5)}>
            +5 {label}
          </button>
          <button type="button" className="btn btn-sm" onClick={onReset}>
            Reset
          </button>
        </div>
      )}
      {label === 'HP' && hpCheck && (
        <div className="mt-3 border-t border-base-300 pt-3">
          <RollableRow label={hpCheck.label} baseTarget={hpCheck.target} openRoll={openRoll} />
        </div>
      )}
      {label === 'FP' && current <= -max && (
        <p className="mt-3 text-xs text-warning">
          FP floor reached — further fatigue costs 1 HP per FP (B426).
        </p>
      )}
    </fieldset>
  );
}

function poolWarnings(bumpers: PoolBumpers): { hp?: string; fp?: string } {
  const result: { hp?: string; fp?: string } = {};
  if (bumpers.hpMax > 0 && bumpers.hp < Math.ceil(bumpers.hpMax / 3)) result.hp = 'Reeling';
  if (bumpers.hp <= 0) result.hp = 'Stay conscious';
  if (bumpers.hp <= -bumpers.hpMax) result.hp = 'Death checks';
  if (bumpers.fpMax > 0 && bumpers.fp < Math.ceil(bumpers.fpMax / 3)) result.fp = 'Tired';
  if (bumpers.fp <= 0) result.fp = 'Exhausted';
  return result;
}

function nullableTextParser(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function StateTrigger({
  label,
  summary,
  open,
  panelId,
  onToggle,
}: {
  label: string;
  summary: string;
  open: boolean;
  panelId: string;
  onToggle: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-sm min-h-11 min-w-0 justify-between gap-2 px-2 text-left md:min-h-10 md:flex-1"
      aria-label={`Change ${label.toLowerCase()}, current ${summary}`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(event) => onToggle(event.currentTarget)}
    >
      <span className="min-w-0">
        <span className="label-eyebrow block text-[8px]">{label}</span>
        <span className="block truncate text-xs font-semibold">{summary}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-[10px] text-base-content/50">
        {open ? '▴' : '▾'}
      </span>
    </button>
  );
}

function ChoicePanel({
  id,
  panelTop,
  title,
  description,
  alignEnd = false,
  children,
}: {
  id: string;
  panelTop: number;
  title: string;
  description?: string;
  alignEnd?: boolean;
  children: ReactNode;
}) {
  const panelStyle = { '--status-panel-top': `${panelTop}px` } as CSSProperties;
  const panelRef = useViewportBoundedOverlay<HTMLElement>();
  return (
    <section
      ref={panelRef}
      id={id}
      style={panelStyle}
      className={`dropdown-content fixed! left-1/2! top-[var(--status-panel-top)]! z-50 max-h-[calc(100dvh_-_var(--status-panel-top)_-_1rem)] w-[calc(100dvw_-_2rem)] max-w-lg translate-x-[calc(-50%+var(--viewport-overlay-shift-x,0px))] overflow-y-auto overscroll-contain rounded-box border border-base-300 bg-base-100 p-4 shadow-arcane-lg md:absolute! md:top-full! md:mt-[9px] md:w-96 md:translate-x-[var(--viewport-overlay-shift-x,0px)] ${alignEnd ? 'md:left-auto! md:right-0!' : 'md:left-0! md:right-auto!'}`}
    >
      <h2 className="font-display text-lg">{title}</h2>
      {description && <p className="mt-1 text-xs text-base-content/60">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function CurrentStatusBar({
  character,
  bumpers,
  canWrite,
  patchCombat,
  openRoll,
  top = 64,
  onHeightChange,
}: CurrentStatusBarProps) {
  const hpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentHp'));
  const fpFlash = useFlashState(makeFlashKey('character_combat', character.id, 'currentFp'));
  const [openPanel, setOpenPanel] = useState<StatusPanel | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [customManeuver, setCustomManeuver] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const { conditions, toggle: toggleCondition } = useConditionsToggle(
    character,
    canWrite,
    patchCombat,
  );
  const posture = character.combat?.posture ?? 'standing';
  const postureSummary = `${posture.charAt(0).toUpperCase()}${posture.slice(1)}`;
  const storedManeuver = character.combat?.maneuver ?? null;
  const activeManeuver = MANEUVERS.find(
    (entry) =>
      storedManeuver != null && entry.label.toLowerCase() === storedManeuver.trim().toLowerCase(),
  );
  const warnings = poolWarnings(bumpers);
  const hpColor = hpVarFor(bumpers.hpMax > 0 ? bumpers.hp / bumpers.hpMax : 0);
  const fpColor = hpVarFor(bumpers.fpMax > 0 ? bumpers.fp / bumpers.fpMax : 0);
  const panelId = useId();
  const conditionSummary =
    conditions.length === 0
      ? 'None'
      : `${conditionLabel(conditions[0] as string)}${conditions.length > 1 ? ` +${conditions.length - 1}` : ''}`;
  const mobileSummary = `${postureSummary} · ${storedManeuver ?? 'No maneuver'} · ${conditionSummary}`;
  const reelingSuggested =
    canWrite &&
    bumpers.hpMax > 0 &&
    bumpers.hp < Math.ceil(bumpers.hpMax / 3) &&
    !conditionsInclude(conditions, 'reeling');

  const maneuverField = useDraftField<string | null>({
    name: 'maneuver',
    serverValue: storedManeuver ?? '',
    parse: nullableTextParser,
    onSave: (value) => patchCombat('maneuver', value),
    flashKey: makeFlashKey('character_combat', character.id, 'maneuver'),
  });
  const commitManeuver = maneuverField.commit;
  const commitPendingCustomManeuver = useCallback(() => {
    if (openPanel === 'maneuver' && customManeuver && canWrite) commitManeuver();
  }, [canWrite, commitManeuver, customManeuver, openPanel]);

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
  const hpCheck: HpCheck | undefined =
    bumpers.hp <= 0
      ? {
          label: bumpers.hp <= -bumpers.hpMax ? 'Death check' : 'Stay conscious',
          target: character.derived.effectiveHt,
        }
      : undefined;
  const activePool =
    openPanel === 'HP'
      ? {
          label: 'HP' as const,
          current: bumpers.hp,
          max: bumpers.hpMax,
          points: hpPoints,
          recovery: 'Recovery: make one HT roll per day; success restores 1 HP (B424).',
          footnote: `At 0 HP or less, roll HT each turn to stay conscious. Death checks begin at −${bumpers.hpMax} HP and repeat at each full −${bumpers.hpMax} HP threshold; certain death is −${5 * bumpers.hpMax} HP.`,
          onDelta: bumpers.bumpHp,
          onReset: bumpers.resetHp,
          onSetValue: bumpers.setHp,
          hpCheck,
        }
      : openPanel === 'FP'
        ? {
            label: 'FP' as const,
            current: bumpers.fp,
            max: bumpers.fpMax,
            points: fpPoints,
            recovery: 'Recovery: normally regain 1 FP per 10 minutes of rest (B426).',
            footnote: `At −${bumpers.fpMax} FP, further fatigue loss is paid from HP instead.`,
            onDelta: bumpers.bumpFp,
            onReset: bumpers.resetFp,
            onSetValue: bumpers.setFp,
          }
        : null;

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !onHeightChange) return;
    const report = () => onHeightChange(bar.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (openPanel === null) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        commitPendingCustomManeuver();
        setOpenPanel(null);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      commitPendingCustomManeuver();
      setOpenPanel(null);
      requestAnimationFrame(() => lastTrigger.current?.focus());
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [commitPendingCustomManeuver, openPanel]);

  const closeAndFocus = () => {
    setOpenPanel(null);
    requestAnimationFrame(() => lastTrigger.current?.focus());
  };
  const togglePanel = (panel: StatusPanel, trigger: HTMLButtonElement) => {
    lastTrigger.current = trigger;
    setOpenPanel((current) => (current === panel ? null : panel));
  };
  // Fixed overlays must start on the first whole pixel after the bar. Using
  // the fractional bottom directly can round the panel upward by one device
  // pixel and leave it overlapping the bar at zoomed/boundary widths.
  const panelTop = Math.ceil(barRef.current?.getBoundingClientRect().bottom ?? top + 120);

  return (
    <aside
      ref={barRef}
      className="fixed inset-x-0 z-40 border-b border-base-300 bg-base-100 shadow-md"
      style={{ top }}
      aria-label="Current Status"
    >
      <div className="mx-auto grid max-w-[80rem] grid-cols-2 gap-2 px-4 py-2 md:grid-cols-[auto_auto_auto_minmax(7rem,1fr)_minmax(10rem,1.5fr)_minmax(8rem,1fr)] md:items-center md:px-7">
        <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 md:col-span-1 md:block md:min-w-28">
          <span className="label-eyebrow">Current Status</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs min-w-0 max-w-[65%] justify-end gap-1 px-1 md:hidden"
            aria-label={`${detailsOpen ? 'Hide' : 'Show'} status details: ${mobileSummary}`}
            aria-expanded={detailsOpen}
            onClick={() => {
              setDetailsOpen((current) => !current);
              setOpenPanel(null);
            }}
          >
            <span className="truncate text-[10px] font-normal text-base-content/60">
              {mobileSummary}
            </span>
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-base-300 text-xs text-primary"
            >
              {detailsOpen ? '▴' : '▾'}
            </span>
          </button>
        </div>
        <div
          className={`dropdown dropdown-start ${openPanel === 'HP' ? 'dropdown-open' : ''}`}
          style={{ color: hpColor }}
        >
          <PoolTrigger
            label="HP"
            current={bumpers.hp}
            max={bumpers.hpMax}
            warning={warnings.hp}
            flashProps={hpFlash.flashProps}
            open={openPanel === 'HP'}
            panelId={panelId}
            onToggle={(trigger) => togglePanel('HP', trigger)}
          />
          {activePool?.label === 'HP' && (
            <PoolAdjustmentPanel
              key={activePool.label}
              id={panelId}
              {...activePool}
              canWrite={canWrite}
              panelTop={panelTop}
              openRoll={openRoll}
            />
          )}
        </div>
        <div
          className={`dropdown dropdown-start ${openPanel === 'FP' ? 'dropdown-open' : ''}`}
          style={{ color: fpColor }}
        >
          <PoolTrigger
            label="FP"
            current={bumpers.fp}
            max={bumpers.fpMax}
            warning={warnings.fp}
            flashProps={fpFlash.flashProps}
            open={openPanel === 'FP'}
            panelId={panelId}
            onToggle={(trigger) => togglePanel('FP', trigger)}
          />
          {activePool?.label === 'FP' && (
            <PoolAdjustmentPanel
              key={activePool.label}
              id={panelId}
              {...activePool}
              canWrite={canWrite}
              panelTop={panelTop}
              openRoll={openRoll}
            />
          )}
        </div>
        <div
          className={`col-span-2 grid-cols-3 gap-2 ${detailsOpen ? 'grid' : 'hidden'} md:contents`}
        >
          <div className={`dropdown ${openPanel === 'posture' ? 'dropdown-open' : ''}`}>
            <StateTrigger
              label="Posture"
              summary={postureSummary}
              open={openPanel === 'posture'}
              panelId={panelId}
              onToggle={(trigger) => togglePanel('posture', trigger)}
            />
            {openPanel === 'posture' && (
              <ChoicePanel id={panelId} panelTop={panelTop} title="Posture">
                <div className="flex flex-wrap gap-2">
                  {POSTURES.map((entry) => (
                    <ConditionChip
                      key={entry}
                      label={entry}
                      active={posture === entry}
                      className="capitalize"
                      onClick={() => {
                        void patchCombat('posture', entry);
                        closeAndFocus();
                      }}
                      disabled={!canWrite}
                    />
                  ))}
                </div>
              </ChoicePanel>
            )}
          </div>
          <div className={`dropdown ${openPanel === 'maneuver' ? 'dropdown-open' : ''}`}>
            <StateTrigger
              label="Maneuver"
              summary={storedManeuver ?? 'None'}
              open={openPanel === 'maneuver'}
              panelId={panelId}
              onToggle={(trigger) => togglePanel('maneuver', trigger)}
            />
            {openPanel === 'maneuver' && (
              <ChoicePanel id={panelId} panelTop={panelTop} title="Maneuver">
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    className={`btn btn-xs ${customManeuver ? '' : 'btn-primary'}`}
                    onClick={() => setCustomManeuver(false)}
                  >
                    Presets
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${customManeuver ? 'btn-primary' : ''}`}
                    onClick={() => setCustomManeuver(true)}
                  >
                    Custom
                  </button>
                </div>
                {customManeuver ? (
                  <input
                    aria-label="Custom maneuver"
                    className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm w-full`}
                    placeholder="e.g. Ready — draw sword"
                    disabled={!canWrite}
                    {...maneuverField.inputProps}
                  />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {MANEUVERS.map((entry) => (
                      <ConditionChip
                        key={entry.id}
                        label={entry.label}
                        active={activeManeuver?.id === entry.id}
                        onClick={() => {
                          void patchCombat(
                            'maneuver',
                            activeManeuver?.id === entry.id ? null : entry.label,
                          );
                          closeAndFocus();
                        }}
                        disabled={!canWrite}
                      />
                    ))}
                  </div>
                )}
                {activeManeuver && (
                  <p className="mt-3 text-xs text-base-content/70">{activeManeuver.blurb}</p>
                )}
              </ChoicePanel>
            )}
          </div>
          <div
            className={`dropdown dropdown-end ${openPanel === 'conditions' ? 'dropdown-open' : ''}`}
          >
            <StateTrigger
              label="Conditions"
              summary={conditionSummary}
              open={openPanel === 'conditions'}
              panelId={panelId}
              onToggle={(trigger) => togglePanel('conditions', trigger)}
            />
            {openPanel === 'conditions' && (
              <ChoicePanel
                id={panelId}
                panelTop={panelTop}
                title="Conditions"
                description="Select every condition that applies. Automatic HP/FP thresholds stay beside their pools."
                alignEnd
              >
                <div className="flex flex-wrap gap-2">
                  {COMMON_CONDITIONS.map((entry) => (
                    <ConditionChip
                      key={entry}
                      label={conditionLabel(entry)}
                      active={conditions.some(
                        (condition) => condition.trim().toLowerCase() === entry.toLowerCase(),
                      )}
                      onClick={() => toggleCondition(entry)}
                      disabled={!canWrite}
                    />
                  ))}
                </div>
                {reelingSuggested && (
                  <p className="mt-3 text-xs text-warning">
                    <InfoTooltip
                      content={`HP (${bumpers.hp}) is below one-third of maximum (B419). Move and Dodge are already halved numerically; Reeling is a manual reminder and adds no extra penalty.`}
                    >
                      Reeling suggested
                    </InfoTooltip>
                  </p>
                )}
                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn btn-primary btn-sm" onClick={closeAndFocus}>
                    Done
                  </button>
                </div>
              </ChoicePanel>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
