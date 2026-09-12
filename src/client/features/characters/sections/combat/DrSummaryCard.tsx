/** Armor inspection and incoming damage share the same typed DR and divisor math. */
import { useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import {
  aggregateDrByLocation,
  armorCoversLocation,
  effectiveDrByLocation,
  innateDrCoversLocation,
  naturalSkullDr,
  resolveDr,
} from '../../../../../shared/domain/armorDr.ts';
import {
  effectiveDrAgainstAttack,
  woundingMultiplier,
} from '../../../../../shared/domain/injuryCalc.ts';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import { ArmorLocationMap } from './ArmorLocationMap.tsx';
import { IncomingDamageDialog } from './IncomingDamageDialog.tsx';
import { ARMOR_DIVISORS, DAMAGE_TYPES, locationLabel } from './armorViewOptions.ts';
import './armor.css';

export interface DrSummaryCardProps {
  character: CharacterDetail;
  canWrite?: boolean;
  hpMax?: number;
  bumpHp?: (delta: number) => void;
}

export function DrSummaryCard({ character, canWrite = false, hpMax, bumpHp }: DrSummaryCardProps) {
  const [location, setLocation] = useState('torso');
  const [type, setType] = useState('cr');
  const [divisor, setDivisor] = useState('');
  const [damageOpen, setDamageOpen] = useState(false);
  const known = character.libraryEffectsKnown !== false && character.houseRulesKnown !== false;
  const protectNaturalDr = character.houseRules?.protectNaturalDr ?? true;
  const map = known ? effectiveDrByLocation(character.inventory, character.effects) : new Map();
  const custom = [...map.keys()].filter((loc) => !HIT_LOCATIONS.includes(loc as never));
  const dr = resolveDr(type, map.get(location));
  const effective = effectiveDrAgainstAttack(type, map.get(location), divisor, protectNaturalDr);
  const multiplier = woundingMultiplier(type, location);
  const layers = known
    ? character.inventory.filter(
        (item) =>
          item.equipped && item.isArmor && item.armor && armorCoversLocation(item.armor, location),
      )
    : [];
  const innate = known
    ? (character.effects ?? [])
        .filter(
          (effect) =>
            effect.active &&
            effect.target === 'dr' &&
            innateDrCoversLocation(effect.hitLocation, location),
        )
        .reduce((sum, effect) => sum + effect.value, 0)
    : 0;

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-label="Armor coverage">
      <div>
        <h2 className="label-eyebrow">Effective DR</h2>
        <p className="text-xs text-muted mt-1">
          Select a location to inspect armor, innate protection, and incoming damage.
        </p>
      </div>
      {!known && (
        <output className="text-sm text-warning">
          DR unavailable: linked library effects or campaign house rules have not loaded.
        </output>
      )}
      <div className="armor-workspace">
        <ArmorLocationMap
          map={map}
          type={type}
          divisor={divisor}
          known={known}
          protectNaturalDr={protectNaturalDr}
          selected={location}
          onSelect={setLocation}
        />
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 min-w-0">
              <span className="label-eyebrow">Hit location</span>
              <select
                className="select select-sm select-bordered w-full"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                {[...HIT_LOCATIONS, ...custom].map((loc) => (
                  <option key={loc} value={loc}>
                    {locationLabel(loc)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 min-w-0">
              <span className="label-eyebrow">Damage type</span>
              <select
                className="select select-sm select-bordered w-full"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {DAMAGE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label-eyebrow">Armor penetration</span>
            <select
              className="select select-sm select-bordered w-full"
              value={divisor}
              onChange={(e) => setDivisor(e.target.value)}
            >
              {ARMOR_DIVISORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl border border-base-300 bg-base-200/50 p-4" aria-live="polite">
            <p className="font-display text-lg">{locationLabel(location)}</p>
            <div className="flex items-baseline gap-3 mt-1">
              <strong className="num text-4xl text-primary" aria-label="Selected effective DR">
                {known ? effective : '—'}
              </strong>
              <span className="text-sm text-muted">
                DR against {DAMAGE_TYPES.find(([value]) => value === type)?.[1]}
              </span>
            </div>
            {known && divisor && (
              <p className="text-xs text-muted mt-2">
                {dr === 0 && effective === 1
                  ? 'Unprotected target: DR 1 against a fractional divisor (B379).'
                  : `Before penetration: ${dr} DR. After penetration: ${effective} DR.`}
              </p>
            )}
            <p className="text-xs text-muted mt-2">
              {protectNaturalDr
                ? 'House rule: armor penetration leaves innate and skull DR intact.'
                : 'Standard rules: armor penetration also reduces innate and skull DR.'}
            </p>
            <p className="text-sm mt-3">
              Penetrating damage × <strong className="num">{multiplier}</strong> injury
            </p>
            <p className="text-xs text-muted">
              The location modifier replaces the damage-type modifier; it does not multiply it
              again.
            </p>
          </div>
          {known && (
            <div>
              <h3 className="label-eyebrow mb-2">Protection before penetration</h3>
              <ul className="divide-y divide-base-300 text-sm" aria-label="Protection layers">
                {layers.map((item) => (
                  <li className="flex justify-between gap-3 py-2" key={item.id}>
                    <span>{item.name}</span>
                    <span className="num shrink-0">
                      {resolveDr(type, aggregateDrByLocation([item]).get(location))} DR
                    </span>
                  </li>
                ))}
                {innate !== 0 && (
                  <li className="flex justify-between gap-3 py-2">
                    <span>Active innate DR</span>
                    <span className="num">{innate} DR</span>
                  </li>
                )}
                {location === 'skull' && naturalSkullDr(type) > 0 && (
                  <li className="flex justify-between gap-3 py-2">
                    <span>Natural skull protection</span>
                    <span className="num">2 DR</span>
                  </li>
                )}
              </ul>
              {layers.length === 0 &&
                innate === 0 &&
                (location !== 'skull' || naturalSkullDr(type) === 0) && (
                  <p className="text-sm text-muted">No protection at this location.</p>
                )}
            </div>
          )}
          <p className="text-xs text-muted">
            Use the attack’s effective divisor after Hardened DR or other special defenses.
            Front-only and back-only armor are currently combined.
          </p>
          {bumpHp && hpMax != null && canWrite && (
            <button
              type="button"
              className="btn btn-primary btn-sm w-full"
              onClick={() => setDamageOpen(true)}
            >
              Incoming damage…
            </button>
          )}
        </div>
      </div>
      <details className="border-t border-base-300 pt-3">
        <summary className="cursor-pointer text-sm text-muted">All locations and DR types</summary>
        <ul
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mt-3 text-sm"
          aria-label="All location DR"
        >
          {known &&
            [...HIT_LOCATIONS, ...custom].map((loc) => {
              const entry = map.get(loc);
              const base = entry?.dr ?? 0;
              const variants = DAMAGE_TYPES.filter(([key]) => key !== 'burn_tight').flatMap(
                ([key]) =>
                  resolveDr(key, entry) !== base ? [`${resolveDr(key, entry)} vs ${key}`] : [],
              );
              return (
                <li key={loc}>
                  <span>{locationLabel(loc)}</span>
                  <span className="num float-right ml-2">{base}</span>
                  {variants.length > 0 && (
                    <small className="block text-muted">{variants.join(' · ')}</small>
                  )}
                </li>
              );
            })}
        </ul>
      </details>
      {damageOpen && bumpHp && hpMax != null && (
        <IncomingDamageDialog
          open
          character={character}
          canWrite={canWrite}
          hpMax={hpMax}
          bumpHp={bumpHp}
          onClose={() => setDamageOpen(false)}
          initialLocation={location}
          initialType={type}
          initialDivisor={divisor}
        />
      )}
    </section>
  );
}
