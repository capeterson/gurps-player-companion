/**
 * Popover for editing the modifiers on an attribute or secondary
 * stat: a permanent mod (optional) and a temporary mod. Defaults to
 * the current values; ±step buttons plus a raw input handle both
 * "magic item gives +2" and "rolled 1d3 = 3" cases. "Clear" zeroes
 * the temp (and the perm mod, when present).
 *
 * Closes on Esc, outside-click, or "Apply". Nothing commits until
 * the user explicitly applies, so the player can dial in the rolled
 * value without firing a mutation per keystroke.
 *
 * Raw inputs are held as strings so intermediate states like "-" or
 * an empty field don't snap back to 0 mid-typing.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatScaled, formatSigned } from '../../../shared/format/number.ts';

interface ModifierField {
  /** Currently committed integer value (raw units). */
  value: number;
  /** Apply callback called with the new integer value (raw units). */
  onApply: (next: number) => void;
  /** Optional inclusive bounds (raw integer units). Apply is rejected if violated. */
  min?: number;
  max?: number;
}

interface TempBoostPopoverProps {
  label: string;
  /** Calculated base value before any perm mod or temp (raw units). */
  baseValue: number;
  temp: ModifierField;
  onClose: () => void;
  /** Multiply stored integer values by this scale for display (e.g. 0.25 for Speed quarter-units). */
  displayScale?: number | undefined;
  /** Optional permanent-modifier section (secondary stats). */
  perm?: ModifierField | undefined;
  /** Tooltip-style cost hint shown beside the perm mod input. */
  permCostLabel?: string | undefined;
  /**
   * Sum of every NAMED (non-manual) temporary effect's contribution to
   * this axis (raw units). The Temporary section here only edits the
   * reserved 'manual' effect -- named effects come from the effects
   * list -- so this is shown read-only, and folded into the effective
   * total, so "base + perm + manual + named = effective" stays legible.
   */
  namedTempContribution?: number | undefined;
}

interface FieldState {
  raw: string;
  delta: number;
  rawDelta: number;
  offStep: boolean;
}

export function TempBoostPopover({
  label,
  baseValue,
  temp,
  onClose,
  displayScale = 1,
  perm,
  permCostLabel,
  namedTempContribution = 0,
}: TempBoostPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  const fmt = (n: number) => formatScaled(n, displayScale);
  // Not formatScaled: `d` here is already in display units (pre-scaled),
  // so this only conditionally fixes precision — it must not re-multiply
  // by displayScale like formatScaled does.
  const fmtInput = (d: number) => (displayScale !== 1 ? d.toFixed(2) : String(d));
  const step = displayScale !== 1 ? displayScale : 1;
  const stepStr = displayScale !== 1 ? displayScale.toFixed(2) : '1';

  const useField = (committed: number): [FieldState, (raw: string) => void] => {
    const [raw, setRaw] = useState<string>(
      fmtInput(committed * (displayScale !== 1 ? displayScale : 1)),
    );
    const parsed = displayScale !== 1 ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    const delta = Number.isNaN(parsed) ? 0 : parsed;
    const rawDelta = displayScale !== 1 ? Math.round(delta / displayScale) : delta;
    const quotient = delta / (displayScale !== 1 ? displayScale : 1);
    const offStep = displayScale !== 1 && Math.abs(Math.round(quotient) - quotient) > 1e-9;
    return [{ raw, delta, rawDelta, offStep }, setRaw];
  };

  const [tempState, setTempRaw] = useField(temp.value);
  const [permState, setPermRaw] = useField(perm?.value ?? 0);

  const effective =
    baseValue + (perm ? permState.rawDelta : 0) + tempState.rawDelta + namedTempContribution;
  const offStep = tempState.offStep || (perm ? permState.offStep : false);
  const outOfRange = (f: ModifierField | undefined, raw: number): boolean =>
    f != null && ((f.min !== undefined && raw < f.min) || (f.max !== undefined && raw > f.max));
  const tempOOR = outOfRange(temp, tempState.rawDelta);
  const permOOR = perm ? outOfRange(perm, permState.rawDelta) : false;
  const fmtBound = (n: number) => formatScaled(n, displayScale);
  const rangeMsg = (f: ModifierField): string =>
    `must be between ${fmtBound(f.min ?? Number.NEGATIVE_INFINITY)} and ${fmtBound(f.max ?? Number.POSITIVE_INFINITY)}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    if (rect.width === 0 || vw === 0) return;
    const margin = 8;
    if (rect.left < margin) {
      el.style.marginLeft = `${margin - rect.left}px`;
    } else if (rect.right > vw - margin) {
      el.style.marginLeft = `-${rect.right - (vw - margin)}px`;
    }
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Defer attaching the click listener until after the current
    // event loop tick: otherwise the same click that opened the
    // popover bubbles up to `document` and immediately closes it.
    const t = setTimeout(() => document.addEventListener('click', handler), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const apply = () => {
    if (offStep || tempOOR || permOOR) return;
    if (tempState.rawDelta !== temp.value) temp.onApply(tempState.rawDelta);
    if (perm && permState.rawDelta !== perm.value) perm.onApply(permState.rawDelta);
    onClose();
  };

  const clear = () => {
    if (temp.value !== 0) temp.onApply(0);
    if (perm && perm.value !== 0) perm.onApply(0);
    onClose();
  };

  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/useSemanticElements: a native <dialog> would require
      // showModal()/close() and lock focus; this is a non-modal popover anchored
      // to the trigger chip, which role="dialog" describes correctly.
      role="dialog"
      aria-label={`Modifiers for ${label}`}
      className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2 w-64 rounded-lg border border-base-300 bg-base-100 p-3 shadow-xl"
    >
      <div className="label-eyebrow mb-2">{label} modifiers</div>
      {perm && (
        <Section
          title="Permanent"
          hint={permCostLabel}
          state={permState}
          setRaw={setPermRaw}
          step={step}
          stepStr={stepStr}
          fmtInput={fmtInput}
          inputMode={displayScale !== 1 ? 'decimal' : 'numeric'}
          ariaLabel={`Permanent ${label} modifier`}
        />
      )}
      <Section
        title="Temporary"
        hint="Buffs from items, spells, alchemy. Does not change point cost."
        state={tempState}
        setRaw={setTempRaw}
        step={step}
        stepStr={stepStr}
        fmtInput={fmtInput}
        inputMode={displayScale !== 1 ? 'decimal' : 'numeric'}
        ariaLabel={`Temporary ${label} delta`}
      />
      {namedTempContribution !== 0 && (
        <p className="text-[11px] text-muted mb-2">
          {formatSigned(namedTempContribution)} from effects
        </p>
      )}
      <div className="num text-[11px] text-muted mb-3">
        {fmt(baseValue)}
        {perm && (
          <>
            {' '}
            + ({permState.delta >= 0 ? '+' : ''}
            {fmtInput(permState.delta)})
          </>
        )}{' '}
        + ({tempState.delta >= 0 ? '+' : ''}
        {fmtInput(tempState.delta)})
        {namedTempContribution !== 0 && <> + ({formatSigned(namedTempContribution)})</>} ={' '}
        <span className="text-base-content font-semibold">{fmt(effective)}</span>
      </div>
      {offStep && <p className="text-[11px] text-error mb-2">must be a multiple of {stepStr}</p>}
      {permOOR && perm && <p className="text-[11px] text-error mb-2">Permanent {rangeMsg(perm)}</p>}
      {tempOOR && <p className="text-[11px] text-error mb-2">Temporary {rangeMsg(temp)}</p>}
      <div className="flex gap-1.5">
        <button type="button" onClick={clear} className="btn btn-sm btn-ghost flex-1">
          Clear
        </button>
        <button
          type="button"
          onClick={apply}
          className="btn btn-sm btn-primary flex-1"
          disabled={offStep || tempOOR || permOOR}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  state,
  setRaw,
  step,
  stepStr,
  fmtInput,
  inputMode,
  ariaLabel,
}: {
  title: string;
  hint?: string | undefined;
  state: FieldState;
  setRaw: (s: string) => void;
  step: number;
  stepStr: string;
  fmtInput: (d: number) => string;
  inputMode: 'decimal' | 'numeric';
  ariaLabel: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label-eyebrow">{title}</span>
        {hint && <span className="text-[10px] text-dim">{hint}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setRaw(fmtInput(state.delta - step))}
          className="btn btn-sm btn-ghost"
          aria-label={`Decrease ${title.toLowerCase()}`}
        >
          −{stepStr}
        </button>
        <input
          type="text"
          inputMode={inputMode}
          value={state.raw}
          onChange={(e) => setRaw(e.target.value)}
          className="num input input-sm input-bordered w-full text-center"
          aria-label={ariaLabel}
        />
        <button
          type="button"
          onClick={() => setRaw(fmtInput(state.delta + step))}
          className="btn btn-sm btn-ghost"
          aria-label={`Increase ${title.toLowerCase()}`}
        >
          +{stepStr}
        </button>
      </div>
    </div>
  );
}
