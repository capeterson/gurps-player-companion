import { AppIcon } from '../../../components/ui/AppIcon.tsx';
/**
 * RollSheet — the actual dice roller. Rendered by the Combat tab
 * whenever `rollRequest` is non-null. Bottom sheet on mobile
 * (`.roll-sheet-back` overrides `.modal-back`'s centering to anchor
 * to the bottom edge below the `md` breakpoint), centered dialog on
 * larger screens.
 *
 * Two variants share the shell:
 *   - Check rolls (default): 3d6 vs an effective target, the ± steppers
 *     adjust the target modifier, presets replace it (single-select).
 *   - Damage rolls (`request.damage` present): NdM+adds with no target;
 *     the ± steppers adjust the flat adds (e.g. All-Out Attack +2) and
 *     presets are hidden.
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
import { createPortal } from 'react-dom';
import { formatDamageDice } from '../../../../shared/constants/damage.ts';
import {
  HIT_LOCATION_AIM_PENALTY,
  type HitLocation,
} from '../../../../shared/constants/hitLocations.ts';
import { minBasicDamageFor } from '../../../../shared/domain/damageParse.ts';
import {
  type CritKind,
  evaluateRoll,
  roll3d6,
  rollDamageDice,
} from '../../../../shared/domain/diceRoll.ts';
import { rangeBandsThrough, rangePenaltyForYards } from '../../../../shared/domain/rangedRange.ts';
import {
  type RuleContext,
  evaluateActionOutcomes,
  evaluateModifiers,
} from '../../../../shared/domain/skillProcedures.ts';
import { formatSigned } from '../../../../shared/format/number.ts';
import { newClientId } from '../../../sync/outbox.ts';
import { SkillRulePreview } from './SkillRulePreview.tsx';
import { HitLocationMap } from './combat/ArmorLocationMap.tsx';
import { locationLabel } from './combat/armorViewOptions.ts';
import { pushRoll } from './rollHistory.ts';
import type { RollRequest } from './rollTypes.ts';
import './combat/armor.css';

export interface RollSheetProps {
  request: RollRequest;
  characterId: string;
  onClose: () => void;
}

// -25 (not -10) so the deepest range-penalty preset (-12, B550) is not
// silently clamped to a different value than its chip advertises, AND
// there's headroom to further compose it with the ± stepper toward a
// deep hit-location penalty (e.g. 200 yd + Eye = -12 + -9 = -21) —
// presets are single-select (see applyPreset), so stacking a second
// penalty on top of a chosen preset is the stepper's job.
const MOD_MIN = -25;
const MOD_MAX = 10;

function clampMod(n: number): number {
  return Math.max(MOD_MIN, Math.min(MOD_MAX, n));
}

interface RollResult {
  readonly manaDisaster: boolean;
  readonly dice: readonly [number, number, number];
  readonly total: number;
  readonly margin: number;
  readonly crit: CritKind;
  readonly success: boolean;
  /** Effective target the roll was made against, so a displayed result
   * is self-describing even after the modifier changes underneath it. */
  readonly target: number;
}

interface DamageResult {
  readonly rolls: readonly number[];
  readonly total: number;
  /** Formula the roll was made with, self-describing like `target` above. */
  readonly formula: string;
}

export function RollSheet({ request, characterId, onClose }: RollSheetProps) {
  const [modifier, setModifier] = useState(0);
  const [context, setContext] = useState<RuleContext>(request.ruleContext ?? {});
  const [choices, setChoices] = useState<Record<string, number>>({});
  const contextual = evaluateModifiers(
    request.rules ?? [],
    context,
    choices,
    Object.fromEntries(
      Object.entries(choices)
        .filter(([k]) => k.startsWith('reference:'))
        .map(([k, v]) => [k.slice(10), v]),
    ),
  );
  const ruleBonus = contextual
    .filter(
      (e) =>
        e.applied &&
        (e.rule.appliesTo === 'task_roll' ||
          (request.action?.contest && e.rule.appliesTo === 'contest')),
    )
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
  // Single-select: picking a preset REPLACES the modifier with its
  // value; tapping the same preset again clears back to +0. This
  // keeps "aim at the skull, then the face" a one-tap gesture instead
  // of requiring a manual reset between picks. Documented simplifying
  // choice per the Phase C plan — a multi-select additive stack would
  // need its own UI to show which presets are contributing.
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [result, setResult] = useState<RollResult | null>(null);
  const [damageResult, setDamageResult] = useState<DamageResult | null>(null);
  const [distance, setDistance] = useState(() => {
    const range = request.attack?.range;
    return range ? Math.min(range.maxYards, Math.max(2, range.minimumYards ?? 0)) : 2;
  });
  const [aimSeconds, setAimSeconds] = useState(0);
  const [hitLocation, setHitLocation] = useState<HitLocation>('torso');
  const [showHitMap, setShowHitMap] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const damage = request.damage;
  const attack = request.attack;
  const bands = attack?.range ? rangeBandsThrough(attack.range.maxYards) : [];
  const selectedBandIndex = bands.findIndex((band) => distance <= band.maxYards);
  const maxRange = attack?.range?.maxYards ?? null;
  const rangeValid =
    !attack?.ranged ||
    maxRange === null ||
    (distance > 0 && distance >= (attack.range?.minimumYards ?? 0) && distance <= maxRange);
  const rangeMod = attack?.ranged && maxRange !== null ? rangePenaltyForYards(distance) : 0;
  const aimMod =
    attack?.ranged && aimSeconds > 0
      ? Math.min(
          Math.max(0, attack.accuracy) + Math.min(aimSeconds - 1, 2),
          Math.max(0, attack.accuracy) * 2,
        )
      : 0;
  const locationMod = attack ? HIT_LOCATION_AIM_PENALTY[hitLocation] : 0;
  const effectiveTarget = Math.floor(
    request.baseTarget + modifier + ruleBonus + rangeMod + aimMod + locationMod,
  );
  // For damage rolls the modifier is flat adds on top of the dice.
  const effectiveDice = damage
    ? { dice: damage.dice.dice, adds: damage.dice.adds + modifier }
    : null;
  const damageSuffix = damage
    ? `${damage.damageType ? ` ${damage.damageType}` : ''}${damage.armorDivisor ? ` (${damage.armorDivisor})` : ''}`
    : '';

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
    setDamageResult(null);
    setActivePreset(null);
    setModifier((m) => clampMod(m + delta));
  }

  function resetModifier() {
    setResult(null);
    setDamageResult(null);
    setActivePreset(null);
    setModifier(0);
  }

  function selectDistance(yards: number) {
    setDistance(yards);
    setResult(null);
  }

  function selectLocation(location: HitLocation) {
    setHitLocation(location);
    setResult(null);
    setShowHitMap(false);
  }

  function doRoll() {
    // Pushed to device-only roll history directly in this click handler — never
    // in an effect — so a StrictMode double-invoke can't double-log a
    // roll, and "Roll again" is just another call to the same handler.
    if (damage && effectiveDice) {
      const rolled = rollDamageDice(effectiveDice, minBasicDamageFor(damage.damageType));
      const formula = `${formatDamageDice(effectiveDice)}${damageSuffix}`;
      setDamageResult({ rolls: rolled.rolls, total: rolled.total, formula });
      pushRoll({
        id: newClientId(),
        at: new Date(),
        characterId,
        label: request.label,
        kind: 'damage',
        dice: rolled.rolls,
        total: rolled.total,
        damageType: damage.damageType,
      });
      return;
    }
    const { dice, total } = roll3d6();
    const outcome = evaluateRoll(effectiveTarget, total);
    const veryHighFailure = request.spellManaLevel === 'very_high' && !outcome.success;
    const crit = veryHighFailure ? 'failure' : outcome.crit;
    const manaDisaster = veryHighFailure && outcome.crit === 'failure';
    setResult({
      manaDisaster,
      dice,
      total,
      margin: outcome.margin,
      crit,
      success: outcome.success,
      target: effectiveTarget,
    });
    pushRoll({
      id: newClientId(),
      at: new Date(),
      characterId,
      label: request.label,
      kind: 'check',
      target: effectiveTarget,
      dice,
      total,
      margin: outcome.margin,
      crit,
      manaDisaster,
    });
  }

  // Portaled to <body>: rendered in place, the fixed overlay is trapped in
  // <main>'s stacking context and the sticky app header covers its top,
  // including the Close button.
  return createPortal(
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
        className="card relative flex max-h-[min(92dvh,900px)] w-full flex-col overflow-hidden rounded-t-2xl shadow-arcane-lg md:w-[30rem] md:max-w-[calc(100dvw-3rem)] md:rounded-2xl"
        style={{
          background: 'var(--color-base-100)',
        }}
      >
        <div className="min-h-0 overflow-y-auto p-5 pb-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="label-eyebrow flex items-center gap-2">
              <AppIcon name="dice" size={18} />
              {damage ? 'Roll damage' : 'Roll'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-sm"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <h2 className="mb-3 min-w-0 wrap-anywhere font-display text-2xl font-semibold">
            {request.label}
          </h2>

          {(request.rules?.length || request.action) && (
            <>
              <SkillRulePreview
                rules={request.rules ?? []}
                source={request.label}
                context={context}
                choices={choices}
                onContext={(v) => {
                  setContext(v);
                  setResult(null);
                }}
                onChoices={(v) => {
                  setChoices(v);
                  setResult(null);
                }}
                {...(request.action ? { action: request.action } : {})}
              />
              <p className="text-xs">
                Base {request.baseTarget} + rules {ruleBonus} + situational {modifier}
              </p>
            </>
          )}
          <div className="mb-3 flex items-baseline justify-center rounded-2xl border border-base-300/60 py-4">
            {damage && effectiveDice ? (
              <span
                className="num font-bold leading-none"
                style={{ fontSize: '2.5rem' }}
                aria-label={`Damage formula ${formatDamageDice(effectiveDice)}${damageSuffix}`}
              >
                {formatDamageDice(effectiveDice)}
                {damageSuffix && (
                  <span className="text-base-content/60 text-2xl">{damageSuffix}</span>
                )}
              </span>
            ) : (
              <span
                className="num font-bold leading-none"
                style={{ fontSize: '4rem' }}
                aria-label={`Effective target ${effectiveTarget}`}
              >
                {effectiveTarget}
              </span>
            )}
          </div>

          {attack?.ranged && (
            <section className="mb-4 space-y-2" aria-label="Range">
              <div className="flex items-center justify-between gap-2">
                <span className="label-eyebrow">Range</span>
                {maxRange !== null && (
                  <span className="text-xs text-base-content/60">Max {maxRange} yd</span>
                )}
              </div>
              {maxRange !== null && bands.length > 0 ? (
                <>
                  <input
                    className="range range-primary w-full"
                    type="range"
                    min={0}
                    max={bands.length - 1}
                    value={selectedBandIndex < 0 ? bands.length - 1 : selectedBandIndex}
                    aria-label="Range band"
                    aria-valuetext={`${distance} yards, ${formatSigned(rangeMod)} range penalty`}
                    onChange={(event) =>
                      selectDistance(bands[Number(event.target.value)]?.maxYards ?? distance)
                    }
                  />
                  <div className="flex items-center gap-2">
                    <label htmlFor="roll-distance" className="text-sm">
                      Distance
                    </label>
                    <input
                      id="roll-distance"
                      className="input input-sm input-bordered w-24"
                      type="number"
                      min={attack.range?.minimumYards ?? 0.01}
                      max={maxRange}
                      step="any"
                      value={distance}
                      onChange={(event) => selectDistance(Number(event.target.value))}
                    />
                    <span className="text-sm">yd · {formatSigned(rangeMod)}</span>
                  </div>
                  {!rangeValid && (
                    <p role="alert" className="text-xs text-error">
                      Distance must be above 0 and no more than {maxRange} yd
                      {attack.range?.minimumYards
                        ? ` (minimum ${attack.range.minimumYards} yd)`
                        : ''}
                      .
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-warning">
                  Set weapon Range and required ST, if applicable, to use the slider. Apply a manual
                  modifier below if needed.
                </p>
              )}
            </section>
          )}

          {attack?.ranged && (
            <section className="mb-4 space-y-2" aria-label="Aim">
              <p className="label-eyebrow">Aim</p>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className={`btn btn-sm ${aimSeconds === seconds ? 'btn-primary' : 'btn-outline'}`}
                    aria-pressed={aimSeconds === seconds}
                    onClick={() => {
                      setAimSeconds(seconds);
                      setResult(null);
                    }}
                  >
                    {seconds === 0 ? 'None' : seconds === 3 ? '3+ sec' : `${seconds} sec`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-base-content/60">
                Acc {attack.accuracy} · Aim {formatSigned(aimMod)} (capped at twice Acc).
              </p>
            </section>
          )}

          {attack && (
            <section className="mb-4 space-y-2" aria-label="Hit location">
              <p className="label-eyebrow">Hit location</p>
              <button
                type="button"
                className="btn btn-outline btn-sm w-full justify-between"
                aria-expanded={showHitMap}
                onClick={() => setShowHitMap((open) => !open)}
              >
                <span>
                  {locationLabel(hitLocation)} {formatSigned(locationMod)}
                </span>
                <span>{showHitMap ? 'Hide map' : 'Choose on map'}</span>
              </button>
              {showHitMap && (
                <HitLocationMap
                  selected={hitLocation}
                  onSelect={(loc) => selectLocation(loc as HitLocation)}
                  valueFor={(loc) => formatSigned(HIT_LOCATION_AIM_PENALTY[loc as HitLocation])}
                  ariaFor={(loc) =>
                    `${locationLabel(loc)} ${formatSigned(HIT_LOCATION_AIM_PENALTY[loc as HitLocation])}`
                  }
                  title="Choose hit location"
                  className="roll-hit-map"
                  disabled={(loc) => !attack.canTargetVitals && (loc === 'vitals' || loc === 'eye')}
                />
              )}
            </section>
          )}

          {attack && (
            <p className="mb-3 text-xs text-base-content/60">
              Base {request.baseTarget} · Range {formatSigned(rangeMod)} · Aim{' '}
              {formatSigned(aimMod)} · {locationLabel(hitLocation)} {formatSigned(locationMod)} ·
              Other {formatSigned(modifier)}
              {ruleBonus ? ` · Rules ${formatSigned(ruleBonus)}` : ''}
            </p>
          )}

          <div className="mb-3 flex items-center justify-center gap-3">
            {attack && <span className="text-sm">Other</span>}
            <button
              type="button"
              className="btn btn-circle btn-sm"
              onClick={() => step(-1)}
              aria-label={damage ? 'Decrease damage adds' : 'Decrease modifier'}
            >
              −
            </button>
            <span className="num w-20 text-center text-sm text-base-content/70">
              {damage
                ? `adds ${formatSigned(modifier)}`
                : attack
                  ? formatSigned(modifier)
                  : `${request.baseTarget} ${formatSigned(modifier)}`}
            </span>
            <button
              type="button"
              className="btn btn-circle btn-sm"
              onClick={() => step(1)}
              aria-label={damage ? 'Increase damage adds' : 'Increase modifier'}
            >
              +
            </button>
            {modifier !== 0 && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={resetModifier}>
                Reset
              </button>
            )}
          </div>

          {!damage && !attack && request.presets && request.presets.length > 0 && (
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
        </div>
        <div
          className="border-t border-base-300/60 p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={doRoll}
            disabled={!rangeValid}
          >
            {damage
              ? damageResult
                ? 'Roll again'
                : `Roll ${effectiveDice ? formatDamageDice(effectiveDice) : 'damage'}`
              : `Roll vs ${effectiveTarget}`}
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-4">
          {damageResult && (
            <div className="mt-3 space-y-1.5 rounded-2xl border border-base-300/60 p-4 text-center">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {damageResult.rolls.map((die, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: dice faces have no identity beyond position.
                    key={i}
                    className="num flex h-9 w-9 items-center justify-center rounded-lg border border-base-300 bg-base-200 font-semibold"
                  >
                    {die}
                  </span>
                ))}
              </div>
              <p className="num text-3xl font-bold">{damageResult.total}</p>
              <p className="text-xs text-base-content/60">{damageResult.formula}</p>
            </div>
          )}

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
              <p
                className={`text-sm font-medium ${result.success ? 'text-success' : 'text-error'}`}
              >
                {result.success ? 'Success' : 'Failure'} · margin {formatSigned(result.margin)}
              </p>
              {result.crit && (
                <span
                  className={`badge ${result.crit === 'success' ? 'badge-success' : 'badge-error'}`}
                >
                  {result.crit === 'success' ? 'Critical success' : 'Critical failure'}
                </span>
              )}
              {request.action &&
                evaluateActionOutcomes(request.action, result, context).map((outcome, i) => (
                  <p key={`${outcome.on}:${i}`}>
                    {outcome.text}
                    {outcome.amount ? ` (${outcome.resolvedAmount ?? 'Context required'})` : ''}
                  </p>
                ))}
              {request.spellManaLevel === 'very_high' && !result.success && (
                <p className="text-sm text-error">
                  {result.manaDisaster
                    ? 'Very high mana: this rolled critical failure causes a spectacular disaster. Ask the GM to resolve it.'
                    : 'Very high mana turns this failure into a critical failure. Resolve the spell critical-failure consequences.'}
                </p>
              )}
              {!result.success && request.onIncomingDamage && (
                <button
                  type="button"
                  className="btn w-full"
                  onClick={() => {
                    onClose();
                    request.onIncomingDamage?.();
                  }}
                >
                  Incoming damage…
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
