/**
 * RollSheet — the actual dice roller. Rendered by the Combat tab
 * whenever `rollRequest` is non-null. Bottom sheet on mobile
 * (`.roll-sheet-back` overrides `.modal-back`'s centering to anchor
 * to the bottom edge below the `md` breakpoint), centered dialog on
 * larger screens.
 *
 * Every defense row in the Combat tab (Dodge/Parry/Block) is also routed
 * through this sheet with `evaluateRoll` as-is. GURPS defenses don't
 * actually use the skill-roll crit table (a defense "critical" is a
 * roll of 3-4 automatic success or 17-18 automatic failure,
 * independent of the defender's score) — reusing `evaluateRoll` here
 * is a deliberate simplification for this feature pass, not a rules
 * engine. Good enough for "did it work, and by how much."
 */

import { useEffect, useState } from 'react';
import { type CritKind, evaluateRoll, roll3d6 } from '../../../../shared/domain/diceRoll.ts';
import { formatSigned } from '../../../../shared/format/number.ts';
import { newClientId } from '../../../sync/outbox.ts';
import { pushRoll } from './rollHistory.ts';
import type { RollRequest } from './rollTypes.ts';

export interface RollSheetProps {
  request: RollRequest;
  characterId: string;
  onClose: () => void;
}

const MOD_MIN = -10;
const MOD_MAX = 10;

function clampMod(n: number): number {
  return Math.max(MOD_MIN, Math.min(MOD_MAX, n));
}

interface RollResult {
  readonly dice: readonly [number, number, number];
  readonly total: number;
  readonly margin: number;
  readonly crit: CritKind;
  readonly success: boolean;
  /** Effective target the roll was made against, so a displayed result
   * is self-describing even after the modifier changes underneath it. */
  readonly target: number;
}

export function RollSheet({ request, characterId, onClose }: RollSheetProps) {
  const [modifier, setModifier] = useState(0);
  // Single-select: picking a preset REPLACES the modifier with its
  // value; tapping the same preset again clears back to +0. This
  // keeps "aim at the skull, then the face" a one-tap gesture instead
  // of requiring a manual reset between picks. Documented simplifying
  // choice per the Phase C plan — a multi-select additive stack would
  // need its own UI to show which presets are contributing.
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [result, setResult] = useState<RollResult | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effectiveTarget = request.baseTarget + modifier;

  function applyPreset(label: string, mod: number) {
    // Changing the effective target invalidates any displayed result --
    // it would otherwise show a margin/crit rolled against a target that
    // no longer matches what's on screen.
    setResult(null);
    if (activePreset === label) {
      setActivePreset(null);
      setModifier(0);
    } else {
      setActivePreset(label);
      setModifier(clampMod(mod));
    }
  }

  function step(delta: number) {
    setResult(null);
    setActivePreset(null);
    setModifier((m) => clampMod(m + delta));
  }

  function resetModifier() {
    setResult(null);
    setActivePreset(null);
    setModifier(0);
  }

  function doRoll() {
    // Pushed to session history directly in this click handler — never
    // in an effect — so a StrictMode double-invoke can't double-log a
    // roll, and "Roll again" is just another call to the same handler.
    const { dice, total } = roll3d6();
    const outcome = evaluateRoll(effectiveTarget, total);
    setResult({
      dice,
      total,
      margin: outcome.margin,
      crit: outcome.crit,
      success: outcome.success,
      target: effectiveTarget,
    });
    pushRoll({
      id: newClientId(),
      at: new Date(),
      characterId,
      label: request.label,
      target: effectiveTarget,
      dice,
      total,
      margin: outcome.margin,
      crit: outcome.crit,
    });
  }

  return (
    <div
      className="modal-back roll-sheet-back"
      // biome-ignore lint/a11y/useSemanticElements: fixed-position aria-roled div, same
      // pattern as the other modal dialogs — Escape is wired via the global keydown listener above.
      role="dialog"
      aria-modal="true"
      aria-label={`Roll ${request.label}`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div
        className="card relative max-h-[85vh] w-full overflow-auto rounded-t-2xl p-5 shadow-arcane-lg md:w-[26rem] md:max-w-[calc(100vw-3rem)] md:rounded-2xl"
        style={{
          background: 'var(--color-base-100)',
          paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="label-eyebrow">Roll</p>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <h2 className="mb-3 font-display text-2xl font-semibold">{request.label}</h2>

        <div className="mb-3 flex items-baseline justify-center rounded-2xl border border-base-300/60 py-4">
          <span
            className="num font-bold leading-none"
            style={{ fontSize: '4rem' }}
            aria-label={`Effective target ${effectiveTarget}`}
          >
            {effectiveTarget}
          </span>
        </div>

        <div className="mb-3 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn btn-circle btn-sm"
            onClick={() => step(-1)}
            aria-label="Decrease modifier"
          >
            −
          </button>
          <span className="num w-20 text-center text-sm text-base-content/70">
            {request.baseTarget} {formatSigned(modifier)}
          </span>
          <button
            type="button"
            className="btn btn-circle btn-sm"
            onClick={() => step(1)}
            aria-label="Increase modifier"
          >
            +
          </button>
          {modifier !== 0 && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={resetModifier}>
              Reset
            </button>
          )}
        </div>

        {request.presets && request.presets.length > 0 && (
          <div className="mb-3 flex flex-wrap justify-center gap-1.5">
            {request.presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chip ${activePreset === p.label ? 'on' : ''}`}
                onClick={() => applyPreset(p.label, p.mod)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <button type="button" className="btn w-full" onClick={doRoll}>
          {result ? 'Roll again' : 'Roll 3d6'}
        </button>

        {result && (
          <div className="mt-3 space-y-1.5 rounded-2xl border border-base-300/60 p-4 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <span className="num flex h-9 w-9 items-center justify-center rounded-lg border border-base-300 bg-base-200 font-semibold">
                {result.dice[0]}
              </span>
              <span className="num flex h-9 w-9 items-center justify-center rounded-lg border border-base-300 bg-base-200 font-semibold">
                {result.dice[1]}
              </span>
              <span className="num flex h-9 w-9 items-center justify-center rounded-lg border border-base-300 bg-base-200 font-semibold">
                {result.dice[2]}
              </span>
            </div>
            <p className="num text-3xl font-bold">{result.total}</p>
            <p className="text-xs text-base-content/60">vs {result.target}</p>
            <p className={`text-sm font-medium ${result.success ? 'text-success' : 'text-error'}`}>
              {result.success ? 'Success' : 'Failure'} · margin {formatSigned(result.margin)}
            </p>
            {result.crit && (
              <span
                className={`badge ${result.crit === 'success' ? 'badge-success' : 'badge-error'}`}
              >
                {result.crit === 'success' ? 'Critical success' : 'Critical failure'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
