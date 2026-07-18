/**
 * IncomingDamageDialog — resolve a hit landing on THIS character: basic
 * damage − DR(location)/divisor → penetrating × wounding multiplier =
 * injury (B378-379), then apply the injury to HP through the shared
 * pool bumpers. DR belongs to the defender, and this is a
 * single-character companion, so "incoming damage" lives on the
 * defender's own sheet rather than an attack-side damage-vs-DR flow.
 *
 * Crippling (B420) is surfaced as a hint only — auto-capping limb
 * injury needs limb-vs-extremity thresholds and an override UI that
 * outgrow this one dialog.
 */

import { type FormEvent, useMemo, useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import { aggregateDrByLocation } from '../../../../../shared/domain/armorDr.ts';
import { applyDamage } from '../../../../../shared/domain/injuryCalc.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { useDialogState } from '../../../../hooks/useDialogState.ts';

/** Damage types offered in the select; free text also accepted via the "other" row. */
const DAMAGE_TYPES = [
  'cr',
  'cut',
  'imp',
  'pi-',
  'pi',
  'pi+',
  'pi++',
  'burn',
  'cor',
  'tox',
] as const;

const LIMB_LOCATIONS = new Set(['arm_left', 'arm_right', 'leg_left', 'leg_right']);
const EXTREMITY_LOCATIONS = new Set(['hand_left', 'hand_right', 'foot_left', 'foot_right']);

function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

function locationLabel(loc: string): string {
  const parts = loc.split('_');
  const words =
    parts.length === 2 && (parts[1] === 'left' || parts[1] === 'right')
      ? [capitalize(parts[1] as string), capitalize(parts[0] as string)]
      : parts.map(capitalize);
  return words.join(' ');
}

export interface IncomingDamageDialogProps {
  open: boolean;
  character: CharacterDetail;
  canWrite: boolean;
  hpMax: number;
  bumpHp: (delta: number) => void;
  onClose: () => void;
}

export function IncomingDamageDialog({
  open,
  character,
  canWrite,
  hpMax,
  bumpHp,
  onClose,
}: IncomingDamageDialogProps) {
  const ref = useDialogState(open);
  const [basicRaw, setBasicRaw] = useState('');
  const [type, setType] = useState<string>('cr');
  const [location, setLocation] = useState('torso');
  const [divisorRaw, setDivisorRaw] = useState('');

  const drMap = useMemo(() => aggregateDrByLocation(character.inventory), [character.inventory]);

  // Custom armor locations the character actually has, beyond the
  // canonical set, so a homebrew "wing"/"tail" location can be targeted.
  const customLocations = useMemo(
    () => [...drMap.keys()].filter((loc) => !HIT_LOCATIONS.includes(loc as never)),
    [drMap],
  );

  const basic = Math.max(0, Math.floor(Number(basicRaw)) || 0);
  const result = applyDamage(basic, type, location, drMap, divisorRaw.trim() || null);

  // Crippling threshold (B420): >HP/2 to a limb, >HP/3 to an extremity.
  const cripplingHint =
    hpMax > 0 &&
    ((LIMB_LOCATIONS.has(location) && result.injury > Math.floor(hpMax / 2)) ||
      (EXTREMITY_LOCATIONS.has(location) && result.injury > Math.floor(hpMax / 3)))
      ? `Injury exceeds the crippling threshold for this ${EXTREMITY_LOCATIONS.has(location) ? 'extremity' : 'limb'} (B420).`
      : null;

  function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || result.injury <= 0) return;
    bumpHp(-result.injury);
    onClose();
  }

  const divisorText = result.effectiveDr !== result.drAtLocation ? `/${divisorRaw.trim()}` : '';
  const breakdown =
    basic > 0
      ? `${basic} ${type} − DR ${result.drAtLocation}${divisorText}${
          divisorText ? `=${result.effectiveDr}` : ''
        } → ${result.penetrating} × ${result.multiplier} = ${result.injury} injury`
      : 'Enter incoming basic damage.';

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
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
                value={DAMAGE_TYPES.includes(type as never) ? type : '__other'}
                onChange={(e) => setType(e.target.value === '__other' ? '' : e.target.value)}
                className="select select-sm select-bordered"
              >
                {DAMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__other">other…</option>
              </select>
            </label>
          </div>

          {!DAMAGE_TYPES.includes(type as never) && (
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
              <input
                value={divisorRaw}
                onChange={(e) => setDivisorRaw(e.target.value)}
                className="input input-sm input-bordered"
                placeholder="none"
              />
            </label>
          </div>

          <p className="num rounded-lg border border-base-300/60 bg-base-200/40 px-3 py-2 text-xs text-base-content/80">
            {breakdown}
          </p>
          {cripplingHint && <p className="text-[11px] text-warning">{cripplingHint}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-sm btn-error"
              disabled={!canWrite || result.injury <= 0}
            >
              Apply −{result.injury} HP
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
