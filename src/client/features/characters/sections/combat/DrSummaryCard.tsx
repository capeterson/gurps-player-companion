/** Armor inspection and incoming damage share the same typed DR and divisor math. */
import { useState } from 'react';
import { HIT_LOCATIONS } from '../../../../../shared/constants/hitLocations.ts';
import {
  type ArmorFacing,
  aggregateDrByLocation,
  armorCoversLocation,
  effectiveDrByLocation,
  innateDrCoversLocation,
  layeredArmorDrContributions,
  naturalSkullDr,
  resolveArmorDb,
  resolveDr,
} from '../../../../../shared/domain/armorDr.ts';
import { pickShield } from '../../../../../shared/domain/defenseCalc.ts';
import {
  effectiveDrAgainstAttack,
  woundingMultiplier,
} from '../../../../../shared/domain/injuryCalc.ts';
import { AppIcon } from '../../../../components/ui/AppIcon.tsx';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import type { RollRequest } from '../rollTypes.ts';
import { ArmorLocationMap } from './ArmorLocationMap.tsx';
import { DefensesCard } from './DefensesCard.tsx';
import { IncomingDamageDialog } from './IncomingDamageDialog.tsx';
import { ARMOR_DIVISORS, DAMAGE_TYPES, locationLabel } from './armorViewOptions.ts';
import './armor.css';

export interface DrSummaryCardProps {
  character: CharacterDetail;
  canWrite?: boolean;
  hpMax?: number;
  bumpHp?: (delta: number) => void;
  openRoll?: (request: RollRequest) => void;
  location?: string;
  facing?: ArmorFacing | undefined;
  onLocationChange?: (location: string) => void;
  onFacingChange?: (facing: ArmorFacing | undefined) => void;
}

interface ArmorDrEnchantmentLine {
  sourceName: string;
  value: number;
  stackingKey: string | null;
  status: 'applied' | 'winning' | 'suppressed' | 'inactive';
  winnerName?: string;
}

function enchantmentLabel(itemName: string, sourceName: string): string {
  const prefix = `${itemName}: `;
  return sourceName.startsWith(prefix) ? sourceName.slice(prefix.length) : sourceName;
}

export function armorDrEnchantmentLines(
  item: CharacterDetail['inventory'][number],
  layers: readonly CharacterDetail['inventory'][number][],
  location: string,
): ArmorDrEnchantmentLine[] {
  return layeredArmorDrContributions(layers, location)
    .filter((line) => line.itemKey === item.id)
    .map((line) => ({
      sourceName: enchantmentLabel(item.name, line.sourceName),
      value: line.value,
      stackingKey: line.stackingKey,
      status: line.status,
      ...(line.winnerName ? { winnerName: enchantmentLabel(item.name, line.winnerName) } : {}),
    }));
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function DrSummaryCard({
  character,
  canWrite = false,
  hpMax,
  bumpHp,
  openRoll = () => {},
  location: controlledLocation,
  facing,
  onLocationChange,
  onFacingChange,
}: DrSummaryCardProps) {
  const [localLocation, setLocalLocation] = useState('torso');
  const [localFacing, setLocalFacing] = useState<ArmorFacing | undefined>(undefined);
  const [type, setType] = useState('cr');
  const [divisor, setDivisor] = useState('');
  const [damageOpen, setDamageOpen] = useState(false);
  const location = controlledLocation ?? localLocation;
  const selectedFacing = facing ?? localFacing;
  const setLocation = (next: string) => {
    setLocalLocation(next);
    onLocationChange?.(next);
  };
  const setFacing = (next: ArmorFacing | undefined) => {
    setLocalFacing(next);
    onFacingChange?.(next);
  };
  const known = character.libraryEffectsKnown !== false && character.houseRulesKnown !== false;
  const protectNaturalDr = character.houseRules?.protectNaturalDr ?? true;
  const map = known ? effectiveDrByLocation(character.inventory, character.effects) : new Map();
  const custom = [...map.keys()].filter((loc) => !HIT_LOCATIONS.includes(loc as never));
  const dr = resolveDr(type, map.get(location));
  const effective = effectiveDrAgainstAttack(type, map.get(location), divisor, protectNaturalDr);
  const multiplier = woundingMultiplier(type, location);
  const shield = pickShield(character.inventory.filter((item) => item.equipped));
  const shieldDb = shield?.db ?? 0;
  const armorDb = resolveArmorDb(character.inventory, location, selectedFacing);
  const totalDb = shieldDb + (armorDb?.db ?? 0);
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
    <section className="card space-y-4 p-4 sm:p-5" aria-label="Defense and damage resistance">
      <div>
        <h2 className="label-eyebrow flex items-center gap-2">
          <AppIcon name="defense" size={18} />
          Defense &amp; Damage Resistance
        </h2>
        <p className="text-xs text-muted mt-1">
          One hit context for armor defense bonus, damage resistance, and incoming damage.
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <label className="flex min-w-0 flex-col gap-1">
              <span className="label-eyebrow">Facing</span>
              <select
                aria-label="Armor facing"
                className="select select-sm select-bordered w-full"
                value={selectedFacing ?? ''}
                onChange={(event) =>
                  setFacing(
                    event.target.value === '' ? undefined : (event.target.value as ArmorFacing),
                  )
                }
              >
                <option value="">Unknown</option>
                <option value="front">Front</option>
                <option value="back">Back</option>
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
            <div className="mt-3 border-t border-base-300 pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">Defense bonus</span>
                <strong className="num text-lg">{totalDb > 0 ? `+${totalDb}` : '—'}</strong>
              </div>
              <p className="text-xs text-muted">
                {armorDb
                  ? `Armor DB +${armorDb.db} from ${armorDb.itemName}`
                  : 'No armor DB for this location and facing'}
                {shieldDb > 0 && shield ? ` · Shield DB +${shieldDb} from ${shield.name}` : ''}.
                Applied to Dodge, Parry, and Block; DB never reduces damage.
              </p>
            </div>
          </div>
          {known && (
            <div>
              <h3 className="label-eyebrow mb-2">Protection before penetration</h3>
              <ul className="divide-y divide-base-300 text-sm" aria-label="Protection layers">
                {layers.map((item) => {
                  const enchantments = armorDrEnchantmentLines(item, layers, location);
                  const baseArmor =
                    item.enchantmentBreakdown !== undefined ? item.baseArmor : undefined;
                  const baseDr = baseArmor
                    ? resolveDr(
                        type,
                        aggregateDrByLocation([
                          { equipped: true, isArmor: true, armor: baseArmor },
                        ]).get(location),
                      )
                    : null;
                  const appliedEnchantmentDr = enchantments
                    .filter((entry) => entry.status === 'applied' || entry.status === 'winning')
                    .reduce((sum, entry) => sum + entry.value, 0);
                  const floorAdjustment =
                    baseDr === null ? 0 : Math.max(0, -(baseDr + appliedEnchantmentDr));
                  const layerDr =
                    baseDr === null
                      ? resolveDr(type, aggregateDrByLocation([item]).get(location))
                      : Math.max(0, baseDr + appliedEnchantmentDr);
                  return (
                    <li className="py-2" key={item.id}>
                      <div className="flex justify-between gap-3">
                        <span>{item.name}</span>
                        <span className="num shrink-0">{layerDr} DR</span>
                      </div>
                      {enchantments.length > 0 && (
                        <ul
                          className="ml-3 mt-1 space-y-1 border-l border-base-300 pl-3 text-xs"
                          aria-label={`${item.name} DR breakdown`}
                        >
                          {baseDr === null ? (
                            <li className="flex justify-between gap-3 text-muted">
                              <span>Base armor unavailable</span>
                            </li>
                          ) : (
                            <li className="flex justify-between gap-3 text-muted">
                              <span>Base armor</span>
                              <span className="num shrink-0">{baseDr} DR</span>
                            </li>
                          )}
                          {enchantments.map((entry, index) => (
                            <li
                              key={`${entry.sourceName}:${entry.stackingKey ?? 'stack'}:${index}`}
                              className={`flex justify-between gap-3 ${
                                entry.status === 'suppressed' || entry.status === 'inactive'
                                  ? 'text-muted'
                                  : ''
                              }`}
                            >
                              <span>
                                <span
                                  className={
                                    entry.status === 'suppressed' || entry.status === 'inactive'
                                      ? 'line-through'
                                      : undefined
                                  }
                                >
                                  {entry.sourceName}
                                </span>
                                {entry.status === 'suppressed' && (
                                  <small className="ml-2">
                                    suppressed
                                    {entry.winnerName ? ` — ${entry.winnerName} wins` : ''}
                                  </small>
                                )}
                                {entry.status === 'inactive' && (
                                  <small className="ml-2">inactive</small>
                                )}
                              </span>
                              <span
                                className={`num shrink-0 ${
                                  entry.status === 'suppressed' || entry.status === 'inactive'
                                    ? 'line-through'
                                    : ''
                                }`}
                              >
                                {signed(entry.value)} DR
                              </span>
                            </li>
                          ))}
                          {floorAdjustment > 0 && (
                            <li className="flex justify-between gap-3 text-muted">
                              <span>Minimum DR floor</span>
                              <span className="num shrink-0">+{floorAdjustment} DR</span>
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
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
            Use the attack’s effective divisor after Hardened DR or other special defenses. Facing
            filters armor DB; front-only and back-only DR are currently combined.
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
      {character.derived && character.encumbrance && character.skills && (
        <div className="border-t border-base-300 pt-4">
          <DefensesCard
            character={character}
            openRoll={openRoll}
            hitLocation={location}
            facing={selectedFacing}
          />
        </div>
      )}
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
