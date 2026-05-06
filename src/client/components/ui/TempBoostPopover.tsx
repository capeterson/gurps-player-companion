/**
 * Popover for editing the temporary delta on an attribute or
 * secondary modifier. Default is the current value; ±1 stepper plus
 * a raw integer input handles both "magic item gives +2" and "rolled
 * 1d3 = 3" cases. "Clear" zeroes it out.
 *
 * Closes on Esc, outside-click, or "Apply". Nothing commits until
 * the user explicitly applies, so the player can dial in the rolled
 * value without firing a mutation per keystroke.
 *
 * Raw input is held as a string so intermediate states like "-" or
 * an empty field don't snap back to 0 mid-typing.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TempBoostPopoverProps {
  label: string;
  baseValue: number;
  currentTemp: number;
  onApply: (next: number) => void;
  onClose: () => void;
  /** Multiply stored integer values by this scale for display (e.g. 0.25 for Speed quarter-units). */
  displayScale?: number | undefined;
}

export function TempBoostPopover({
  label,
  baseValue,
  currentTemp,
  onApply,
  onClose,
  displayScale = 1,
}: TempBoostPopoverProps) {
  const [raw, setRaw] = useState<string>(String(currentTemp));
  const ref = useRef<HTMLDivElement>(null);

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

  const parsed = Number.parseInt(raw, 10);
  const numValue = Number.isNaN(parsed) ? 0 : parsed;
  const effective = baseValue + numValue;
  const fmt = (n: number) => (displayScale !== 1 ? (n * displayScale).toFixed(2) : String(n));
  const stepStr = displayScale !== 1 ? displayScale.toFixed(2) : '1';

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

  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/useSemanticElements: a native <dialog> would require
      // showModal()/close() and lock focus; this is a non-modal popover anchored
      // to the trigger chip, which role="dialog" describes correctly.
      role="dialog"
      aria-label={`Temporary modifier for ${label}`}
      className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2 w-64 rounded-lg border border-base-300 bg-base-100 p-3 shadow-xl"
    >
      <div className="label-eyebrow mb-2">Temporary {label}</div>
      <div className="text-[11px] text-dim mb-2">
        Buffs from items, spells, alchemy. Applies to derived stats and skills; does not change
        point cost.
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => setRaw(String(numValue - 1))}
          className="btn btn-sm btn-ghost"
          aria-label="Decrease"
        >
          −{stepStr}
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="num input input-sm input-bordered w-full text-center"
          aria-label={`Temporary ${label} delta`}
        />
        <button
          type="button"
          onClick={() => setRaw(String(numValue + 1))}
          className="btn btn-sm btn-ghost"
          aria-label="Increase"
        >
          +{stepStr}
        </button>
      </div>
      <div className="num text-[11px] text-muted mb-3">
        {fmt(baseValue)} + ({numValue >= 0 ? '+' : ''}
        {fmt(numValue)}) = <span className="text-base-content font-semibold">{fmt(effective)}</span>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            onApply(0);
            onClose();
          }}
          className="btn btn-sm btn-ghost flex-1"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(numValue);
            onClose();
          }}
          className="btn btn-sm btn-primary flex-1"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
