/**
 * IncomingDamageDialog — resolve a hit landing on THIS character: basic
 * damage − DR(location)/divisor → penetrating × wounding multiplier =
 * injury (B378-379), then apply the injury to HP through the shared
 * pool bumpers. DR belongs to the defender, and this is a
 * single-character companion, so "incoming damage" lives on the
 * defender's own sheet rather than an attack-side damage-vs-DR flow.
 *
 * Limb/extremity HP loss is capped at the minimum crippling injury
 * (B421). Conditions remain manual; hints retain the full pre-cap injury.
 */

import { type FormEvent, useMemo, useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import { effectiveDrByLocation } from '../../../../../shared/domain/armorDr.ts';
import { applyDamage, parseArmorDivisor } from '../../../../../shared/domain/injuryCalc.ts';
import { useDialogState } from '../../../../hooks/useDialogState.ts';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import { ARMOR_DIVISORS, DAMAGE_TYPES, locationLabel } from './armorViewOptions.ts';

export interface IncomingDamageDialogProps {
  open: boolean;
  character: CharacterDetail;
  canWrite: boolean;
  hpMax: number;
  bumpHp: (delta: number) => void;
  onClose: () => void;
  initialLocation?: string;
  initialType?: string;
  initialDivisor?: string;
}

export function IncomingDamageDialog({
  open,
  character,
  canWrite,
  hpMax,
  bumpHp,
  onClose,
  initialLocation = 'torso',
  initialType = 'cr',
  initialDivisor = '',
}: IncomingDamageDialogProps) {
  const ref = useDialogState(open);
  const [basicRaw, setBasicRaw] = useState('');
  const [type, setType] = useState(initialType);
  const [location, setLocation] = useState(initialLocation);
  const [divisorRaw, setDivisorRaw] = useState(initialDivisor);
  const [customDivisor, setCustomDivisor] = useState(
    !ARMOR_DIVISORS.some(([value]) => value === initialDivisor),
  );
  const effectsKnown = character.libraryEffectsKnown !== false;

  const drMap = useMemo(
    () => effectiveDrByLocation(character.inventory, character.effects),
    [character.inventory, character.effects],
  );

  // Custom armor locations the character actually has, beyond the
  // canonical set, so a homebrew "wing"/"tail" location can be targeted.
  const customLocations = useMemo(
    () => [...drMap.keys()].filter((loc) => !HIT_LOCATIONS.includes(loc as never)),
    [drMap],
  );

  const validBasic = /^\d+$/.test(basicRaw.trim()) && Number.isSafeInteger(Number(basicRaw));
  const basic = validBasic ? Number(basicRaw) : 0;
  const validDivisor = !divisorRaw.trim() || parseArmorDivisor(divisorRaw) != null;
  const fatigueType = type.trim().toLowerCase() === 'fat';
  const valid = validBasic && validDivisor && !fatigueType;
  const result = applyDamage(basic, type, location, drMap, divisorRaw.trim() || null, hpMax);
  const cripplingHint = result.destroyed
    ? `Pre-cap injury is at least twice the crippling threshold: the body part is destroyed${type.trim().toLowerCase() === 'cut' ? ' (severed by cutting damage)' : ''}. Apply the condition manually (B421).`
    : result.crippled
      ? 'This injury cripples the body part. Apply the condition manually (B421).'
      : null;

  function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !effectsKnown || !valid || result.injury <= 0) return;
    bumpHp(-result.injury);
    onClose();
  }

  const divisorText =
    divisorRaw === 'ignore'
      ? ' (bypassed)'
      : result.effectiveDr !== result.drAtLocation
        ? `/${divisorRaw.trim()}`
        : '';
  const breakdown = !effectsKnown
    ? 'Linked library effects are unavailable. Reconnect and load them before applying damage.'
    : basic > 0
      ? `${basic} ${type} − DR ${result.drAtLocation}${divisorText}${
          divisorText ? `=${result.effectiveDr}` : ''
        } → ${result.penetrating} × ${result.multiplier} = ${result.preCapInjury} injury${
          result.preCapInjury !== result.injury ? `; capped at ${result.injury} HP loss` : ''
        }`
      : 'Enter incoming basic damage.';

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label="Incoming damage"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="modal-box bg-base-100 border border-base-300/60 rounded-2xl max-w-md">
        <h3 className="font-display text-xl font-semibold">Incoming damage</h3>
        <form onSubmit={handleApply} className="mt-3 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Basic damage</span>
              <input
                value={basicRaw}
                inputMode="numeric"
                onChange={(e) => setBasicRaw(e.target.value)}
                className="num input input-sm input-bordered text-right"
                placeholder="0"
                // biome-ignore lint/a11y/noAutofocus: first field of a small purpose-built dialog.
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Type</span>
              <select
                value={DAMAGE_TYPES.some(([value]) => value === type) ? type : '__other'}
                onChange={(e) => setType(e.target.value === '__other' ? '' : e.target.value)}
                className="select select-sm select-bordered"
              >
                {DAMAGE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                <option value="__other">other…</option>
              </select>
            </label>
          </div>

          {!DAMAGE_TYPES.some(([value]) => value === type) && (
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Custom type</span>
              <input
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="input input-sm input-bordered"
                placeholder="e.g. fat"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Hit location</span>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="select select-sm select-bordered"
              >
                {HIT_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {locationLabel(loc)}
                  </option>
                ))}
                {customLocations.map((loc) => (
                  <option key={loc} value={loc}>
                    {locationLabel(loc)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Armor divisor</span>
              <select
                value={customDivisor ? '__custom' : divisorRaw}
                onChange={(event) => {
                  const custom = event.target.value === '__custom';
                  setCustomDivisor(custom);
                  setDivisorRaw(custom ? '' : event.target.value);
                }}
                className="select select-sm select-bordered"
              >
                {ARMOR_DIVISORS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                <option value="__custom">Custom divisor…</option>
              </select>
            </label>
          </div>
          {customDivisor && (
            <label className="flex flex-col gap-1">
              <span className="label-eyebrow">Custom armor divisor</span>
              <input
                value={divisorRaw}
                onChange={(event) => setDivisorRaw(event.target.value)}
                className="input input-sm input-bordered"
                placeholder="e.g. (2) or 0.5"
                aria-invalid={!validDivisor}
              />
            </label>
          )}
          {!validDivisor && (
            <p role="alert" className="text-xs text-error">
              Enter a positive armor divisor, such as 2 or (0.5).
            </p>
          )}
          {basicRaw.trim() && !validBasic && (
            <p role="alert" className="text-xs text-error">
              Basic damage must be a non-negative whole number.
            </p>
          )}
          {fatigueType && (
            <p role="alert" className="text-xs text-warning">
              Fatigue damage affects FP. Use the Fatigue pool controls instead of applying HP
              injury.
            </p>
          )}

          <p className="num rounded-lg border border-base-300/60 bg-base-200/40 px-3 py-2 text-xs text-base-content/80">
            {breakdown}
          </p>
          {effectsKnown && cripplingHint && (
            <p className="text-[11px] text-warning">{cripplingHint}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-error"
              disabled={!canWrite || !effectsKnown || !valid || result.injury <= 0}
            >
              {effectsKnown ? `Apply −${result.injury} HP` : 'Damage unavailable'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
