/**
 * IncomingDamageDialog — resolve a hit landing on THIS character: basic
 * damage − DR(location)/divisor → penetrating × wounding multiplier =
 * injury (B378-379), then apply the injury to HP through the shared
 * pool bumpers. The selected target, facing, type, and divisor are read-only
 * context from Incoming attack so the injury calculation cannot diverge from
 * the defense calculation. DR belongs to the defender, and this is a
 * single-character companion, so "incoming damage" lives on the
 * defender's own sheet rather than an attack-side damage-vs-DR flow.
 *
 * Limb/extremity HP loss is capped at the minimum crippling injury
 * (B421). Conditions remain manual; hints retain the full pre-cap injury.
 */

import { type FormEvent, useMemo, useState } from 'react';
import {
  type ArmorFacing,
  effectiveDrByLocation,
  resolveArmorDb,
} from '../../../../../shared/domain/armorDr.ts';
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
  onApplied?: () => void;
  location: string;
  facing: ArmorFacing;
  type: string;
  divisor: string;
  defenseUsed?: string | null;
}

export function IncomingDamageDialog({
  open,
  character,
  canWrite,
  hpMax,
  bumpHp,
  onClose,
  onApplied,
  location,
  facing,
  type,
  divisor,
  defenseUsed,
}: IncomingDamageDialogProps) {
  const ref = useDialogState(open);
  const [basicRaw, setBasicRaw] = useState('');
  const effectsKnown =
    character.libraryEffectsKnown !== false && character.houseRulesKnown !== false;
  const protectNaturalDr = character.houseRules?.protectNaturalDr ?? true;

  const drMap = useMemo(
    () => effectiveDrByLocation(character.inventory, character.effects, facing),
    [character.inventory, character.effects, facing],
  );

  const validBasic = /^\d+$/.test(basicRaw.trim()) && Number.isSafeInteger(Number(basicRaw));
  const basic = validBasic ? Number(basicRaw) : 0;
  const validDivisor = !divisor.trim() || parseArmorDivisor(divisor) != null;
  const fatigueType = type.trim().toLowerCase() === 'fat';
  const valid = validBasic && validDivisor && !fatigueType;
  const result = applyDamage(
    basic,
    type,
    location,
    drMap,
    divisor.trim() || null,
    hpMax,
    protectNaturalDr,
  );
  const armorDb = resolveArmorDb(character.inventory, location, facing);
  const cripplingHint = result.destroyed
    ? `Pre-cap injury is at least twice the crippling threshold: the body part is destroyed${type.trim().toLowerCase() === 'cut' ? ' (severed by cutting damage)' : ''}. Apply the condition manually (B421).`
    : result.crippled
      ? 'This injury cripples the body part. Apply the condition manually (B421).'
      : null;

  function handleApply(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !effectsKnown || !valid || result.injury <= 0) return;
    bumpHp(-result.injury);
    onApplied?.();
    onClose();
  }

  const divisorText =
    protectNaturalDr && (parseArmorDivisor(divisor) ?? 1) > 1
      ? ' (armor penetration; natural DR unchanged)'
      : result.drAtLocation === 0 && result.effectiveDr === 1
        ? ' (unprotected target: DR 1, B379)'
        : parseArmorDivisor(divisor) === Number.POSITIVE_INFINITY
          ? ' (bypassed)'
          : result.effectiveDr !== result.drAtLocation
            ? `/${divisor.trim()}`
            : '';
  const breakdown = !effectsKnown
    ? 'Linked library effects or campaign house rules are unavailable. Reconnect and load them before applying damage.'
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
          <p
            className="rounded-lg border border-base-300/60 bg-base-200/40 px-3 py-2 text-xs text-base-content/80"
            aria-label="Incoming attack context"
          >
            <strong>{locationLabel(location)}</strong> · {facing} ·{' '}
            {DAMAGE_TYPES.find(([value]) => value === type)?.[1] ?? type} ·{' '}
            {ARMOR_DIVISORS.find(([value]) => value === divisor)?.[1] ?? `Divisor ${divisor}`}
            <span className="block mt-1">
              {defenseUsed
                ? `Selected defense: ${defenseUsed}. Confirm the hit before applying injury.`
                : 'Confirm that the attack hits before applying injury.'}
            </span>
          </p>
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
          <p className="rounded-lg border border-base-300/60 px-3 py-2 text-xs text-base-content/80">
            {armorDb
              ? `Armor DB ${armorDb.db} (${armorDb.itemName}) applies to defense only; it is not DR and does not reduce damage.`
              : 'Armor DB: none at this location. DB does not reduce damage.'}
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
