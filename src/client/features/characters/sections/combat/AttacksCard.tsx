import { useState } from 'react';
import { formatDamageDice, parseDerivedDamage } from '../../../../../shared/constants/damage.ts';
import {
  HIT_LOCATIONS,
  HIT_LOCATION_AIM_PENALTY,
  type HitLocation,
} from '../../../../../shared/constants/hitLocations.ts';
import { RANGE_PENALTY_STEPS } from '../../../../../shared/constants/rangePenalty.ts';
import { combatAdjustments } from '../../../../../shared/domain/combatAdjustments.ts';
import {
  canTargetVitals,
  parseDamageSpec,
  resolveDamage,
} from '../../../../../shared/domain/damageParse.ts';
import {
  resolveWeaponSkill,
  skillDisplayName,
  stShortfallPenalty,
} from '../../../../../shared/domain/defenseCalc.ts';
import type { RangedData, WeaponData } from '../../../../../shared/schemas/inventory.ts';
import { DragHandle } from '../../../../components/ui/DragHandle.tsx';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import type { RollPreset, RollRequest } from '../rollTypes.ts';
import {
  type AttackSort,
  type AttackTablePreferences,
  readAttackTablePreferences,
  saveAttackTablePreferences,
} from './attackTablePreferences.ts';
import {
  ModifierBreakdown,
  WeaponEffectDiagnostics,
  effectTotal,
  skillEffectsForRow,
  weaponEffectsForRow,
} from './weaponEffectView.tsx';

function capitalize(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

/** All the penalty table's values are <= 0; render "0" or "−N". */
function fmtPenalty(n: number): string {
  return n === 0 ? '0' : `−${Math.abs(n)}`;
}

/** 'arm_left' -> "Left Arm (−2)"; single-word locations pass through untouched. */
function hitLocationLabel(loc: HitLocation): string {
  const parts = loc.split('_');
  const words =
    parts.length === 2 && (parts[1] === 'left' || parts[1] === 'right')
      ? [capitalize(parts[1] as string), capitalize(parts[0] as string)]
      : parts.map(capitalize);
  return `${words.join(' ')} (${fmtPenalty(HIT_LOCATION_AIM_PENALTY[loc])})`;
}

const HIT_LOCATION_PRESETS: readonly RollPreset[] = HIT_LOCATIONS.map((loc) => ({
  label: hitLocationLabel(loc),
  mod: HIT_LOCATION_AIM_PENALTY[loc],
}));

// Vitals and eye presets, excluded per-weapon when none of the weapon's
// damage modes can target them (B399: only imp/pi attacks, or a
// tight-beam burn we can't infer from free text — see canTargetVitals).
const VITALS_ONLY_LOCATIONS = new Set<HitLocation>(['vitals', 'eye']);
const HIT_LOCATION_PRESETS_NO_VITALS: readonly RollPreset[] = HIT_LOCATIONS.filter(
  (loc) => !VITALS_ONLY_LOCATIONS.has(loc),
).map((loc) => ({
  label: hitLocationLabel(loc),
  mod: HIT_LOCATION_AIM_PENALTY[loc],
}));

// Speed/range penalties as presets (B550), same single-select chip model
// as hit locations. The 0-penalty band is omitted — it changes nothing.
const RANGE_PRESETS: readonly RollPreset[] = RANGE_PENALTY_STEPS.filter((s) => s.penalty !== 0).map(
  (s) => ({
    label: `${s.maxYards} yd (${fmtPenalty(s.penalty)})`,
    mod: s.penalty,
  }),
);

/** "Acc 3 · 100/150 · RoF 1 · Shots 9+1(3) · Bulk −4 · Rcl 2" from present fields only. */
function rangedStatLine(r: RangedData): string {
  const parts: string[] = [];
  if (r.acc != null) parts.push(`Acc ${r.acc}`);
  if (r.range) parts.push(r.range);
  if (r.rof) parts.push(`RoF ${r.rof}`);
  if (r.shots) parts.push(`Shots ${r.shots}`);
  if (r.bulk != null) parts.push(`Bulk ${r.bulk === 0 ? '0' : `−${Math.abs(r.bulk)}`}`);
  if (r.recoil != null) parts.push(`Rcl ${r.recoil}`);
  return parts.join(' · ');
}

/**
 * The weapon's damage lines, primary first, then each alternate mode.
 *
 * The primary line is unnamed (it IS the weapon); alternates carry the
 * mode name so "Swing" and "Thrust" are distinguishable in the chip row.
 * An alternate that leaves `reach` unset inherits the weapon's — a swing
 * and a thrust with the same reach only state it once.
 */
interface DamageLine {
  readonly key: string;
  readonly modeName: string | null;
  readonly damage: string | undefined;
  readonly reach: string | null | undefined;
}

function damageLinesFor(weaponName: string, wd: WeaponData): DamageLine[] {
  const lines: DamageLine[] = [
    { key: `${weaponName}:primary`, modeName: null, damage: wd.damage, reach: wd.reach },
  ];
  for (const [i, mode] of (wd.alternateModes ?? []).entries()) {
    lines.push({
      key: `${weaponName}:mode:${i}:${mode.name}`,
      modeName: mode.name,
      damage: mode.damage,
      reach: mode.reach ?? wd.reach,
    });
  }
  // A weapon whose primary line carries no damage at all (alternates-only
  // data entry) shouldn't render an empty leading row.
  return lines.filter((line, i) => i > 0 || line.damage !== undefined || lines.length === 1);
}

export interface AttacksCardProps {
  character: CharacterDetail;
  openRoll: (req: RollRequest) => void;
}

export function AttacksCard({ character, openRoll }: AttacksCardProps) {
  // A route change must not carry the previous character's presentation state.
  return <AttackTable key={character.id} character={character} openRoll={openRoll} />;
}

function AttackTable({ character, openRoll }: AttacksCardProps) {
  const effects = character.effects ?? [];
  const [preferences, setPreferences] = useState(() => readAttackTablePreferences(character.id));
  const [saveFailed, setSaveFailed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  function save(next: AttackTablePreferences) {
    setPreferences(next);
    setSaveFailed(!saveAttackTablePreferences(character.id, next));
  }

  function sortBy(sort: AttackSort) {
    save({
      ...preferences,
      sort,
      descending: sort === preferences.sort && sort !== 'custom' ? !preferences.descending : false,
    });
  }

  const state = combatAdjustments({
    hp: character.combat?.currentHp ?? character.derived.hp,
    maxHp: character.derived.hp,
    fp: character.combat?.currentFp ?? character.derived.fp,
    maxFp: character.derived.fp,
    posture: character.combat?.posture ?? 'standing',
    conditions: character.combat?.conditions ?? [],
    maneuver: character.combat?.maneuver ?? null,
  });
  const weapons = character.inventory.filter((i) => i.equipped && i.weaponData != null);
  // Consume the shared derived result, which already includes damage effects.
  // Rebuilding from ST here would silently drop those flat adds.
  const effectsKnown = character.libraryEffectsKnown !== false;
  const thrust = effectsKnown ? parseDerivedDamage(character.derived.thrust) : null;
  const swing = effectsKnown ? parseDerivedDamage(character.derived.swing) : null;
  // effectiveLevel folds in trait/skill effect bonuses (skillBonusFor) —
  // the same value SkillsPanel rolls against, so attack rolls agree.
  const skillCandidates = character.skills.map((s) => ({
    name: skillDisplayName(s.name, s.specialization),
    level: s.effectiveLevel ?? s.level,
  }));

  const customOrder = [
    ...preferences.order.filter((id) => weapons.some((weapon) => weapon.id === id)),
    ...weapons
      .filter((weapon) => !preferences.order.includes(weapon.id))
      .map((weapon) => weapon.id),
  ];
  const sortedWeapons = [...weapons].sort((a, b) => {
    if (preferences.sort === 'custom') return customOrder.indexOf(a.id) - customOrder.indexOf(b.id);
    function value(weapon: (typeof weapons)[number]): string {
      if (preferences.sort === 'weapon') return weapon.name;
      if (preferences.sort === 'skill') {
        const resolution = resolveWeaponSkill(
          weapon.name,
          weapon.weaponData?.skill,
          skillCandidates,
        );
        return resolution.kind === 'matched' ? resolution.name : (weapon.weaponData?.skill ?? '');
      }
      return damageLinesFor(weapon.name, weapon.weaponData ?? { alternateModes: [] })
        .flatMap((line) =>
          line.damage ? parseDamageSpec(line.damage).map((mode) => mode.type ?? '') : [],
        )
        .sort()
        .join('/');
    }
    const comparison = value(a).localeCompare(value(b), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    return (
      (preferences.descending ? -comparison : comparison) ||
      customOrder.indexOf(a.id) - customOrder.indexOf(b.id)
    );
  });

  function moveWeapon(id: string, targetId: string) {
    const from = customOrder.indexOf(id);
    const to = customOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...customOrder];
    next.splice(from, 1);
    next.splice(to, 0, id);
    // Keep unequipped IDs so putting a weapon away does not discard its preference.
    const hiddenIds = preferences.order.filter((savedId) => !customOrder.includes(savedId));
    save({ order: [...next, ...hiddenIds], sort: 'custom', descending: false });
    setAnnouncement(
      `${weapons.find((weapon) => weapon.id === id)?.name ?? 'Attack'} moved to position ${to + 1}.`,
    );
  }

  function sortHeader(label: string, sort: Exclude<AttackSort, 'custom'>) {
    const active = preferences.sort === sort;
    return (
      <th
        scope="col"
        aria-sort={active ? (preferences.descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs -ml-2 whitespace-nowrap"
          onClick={() => sortBy(sort)}
        >
          {label}{' '}
          <span aria-hidden="true">{active ? (preferences.descending ? '↓' : '↑') : '↕'}</span>
        </button>
      </th>
    );
  }

  if (weapons.length === 0) {
    return (
      <FoldSection preferenceKey={`${character.id}:AttacksCard`} title="Attacks">
        <p className="text-sm text-base-content/60">
          No equipped weapons — equip items in the Inventory tab.
        </p>
      </FoldSection>
    );
  }

  return (
    <FoldSection preferenceKey={`${character.id}:AttacksCard`} title="Attacks">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
        <p className="label-eyebrow">
          <span className="text-base-content/50">{weapons.length} equipped weapons</span>
        </p>
        <label className="flex items-center gap-2 text-xs text-base-content/60">
          Order
          <select
            aria-label="Attack order"
            className="select select-sm w-36"
            value={preferences.sort}
            onChange={(event) => sortBy(event.target.value as AttackSort)}
          >
            <option value="custom">Custom</option>
            <option value="weapon">Weapon</option>
            <option value="skill">Governing skill</option>
            <option value="type">Damage type</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-base-content/50">
        Tap a skill to attack or dice to roll damage.
        {preferences.sort === 'custom' &&
          ' Drag the handles to reorder; use ↑/↓ with a keyboard. Order is saved on this device.'}
      </p>
      {saveFailed && (
        <output className="text-xs text-warning">
          This browser could not save the attack order. It will reset when you leave this page.
        </output>
      )}
      <output className="sr-only">{announcement}</output>
      {!effectsKnown && (
        <p className="text-xs text-warning">
          ST-based damage is unavailable until linked library effects load.
        </p>
      )}
      <WeaponEffectDiagnostics
        effects={effects.filter((effect) =>
          ['weapon_attack', 'weapon_damage', 'weapon_accuracy'].includes(effect.target),
        )}
        inventory={character.inventory}
      />
      <div className="overflow-x-auto">
        <table className="table table-sm w-full">
          <caption className="sr-only">
            Equipped weapon attacks. Sort columns or choose Custom to reorder weapons.
          </caption>
          <thead>
            <tr>
              {preferences.sort === 'custom' && (
                <th scope="col" className="w-9">
                  <span className="sr-only">Reorder</span>
                </th>
              )}
              {sortHeader('Weapon', 'weapon')}
              {sortHeader('Governing skill', 'skill')}
              <th scope="col">Damage</th>
              {sortHeader('Type', 'type')}
              <th scope="col">Reach</th>
            </tr>
          </thead>
          {sortedWeapons.map((w, weaponIndex) => {
            const wd = w.weaponData;
            if (!wd) return null;
            const lines = damageLinesFor(w.name, wd);
            const parsedByLine = lines.map((line) => ({
              line,
              modes: line.damage ? parseDamageSpec(line.damage) : [],
            }));
            const allModes = parsedByLine.flatMap((p) => p.modes);
            const stPenalty = stShortfallPenalty(
              wd.stRequired,
              state.strength(character.derived.effectiveSt),
            );
            const resolution = resolveWeaponSkill(w.name, wd.skill, skillCandidates);
            // Only offer the vitals/eye presets when at least one of the
            // weapon's parsed damage modes -- across EVERY attack mode --
            // can target them (B399). A weapon with no parseable modes at
            // all (free-text homebrew damage) keeps the full preset list
            // rather than being punished for not parsing.
            const canHitVitals =
              allModes.length === 0 || allModes.some((m) => canTargetVitals(m.type));
            const locationPresets = canHitVitals
              ? HIT_LOCATION_PRESETS
              : HIT_LOCATION_PRESETS_NO_VITALS;
            // Ranged weapons get Aim (+Acc) and the speed/range penalties
            // ahead of hit locations. Single-select like every preset —
            // range + location stacking composes via the ± steppers.
            const ranged = wd.ranged;
            const primaryAttackEffects = weaponEffectsForRow(
              effects,
              w.id,
              'weapon_attack',
              'primary',
            );
            const primaryAccuracyEffects = weaponEffectsForRow(
              effects,
              w.id,
              'weapon_accuracy',
              'primary',
            );
            const skillEffects =
              resolution.kind === 'matched' ? skillEffectsForRow(effects, resolution.name) : [];

            const rows = parsedByLine.flatMap(({ line, modes }) =>
              (modes.length ? modes : [null]).map((mode, index) => ({
                line,
                mode,
                key: `${line.key}:${index}`,
              })),
            );
            return (
              <tbody
                key={w.id}
                aria-label={w.name}
                className={`border-t border-base-300/60 ${draggingId === w.id ? 'opacity-40' : ''} ${dropTarget === w.id ? 'bg-base-200' : ''}`}
                onDragEnter={(event) => {
                  if (draggingId) {
                    event.preventDefault();
                    setDropTarget(w.id);
                  }
                }}
                onDragOver={(event) => {
                  if (draggingId) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(event) => {
                  if (!draggingId) return;
                  event.preventDefault();
                  moveWeapon(draggingId, w.id);
                  setDraggingId(null);
                  setDropTarget(null);
                }}
              >
                {rows.map(({ line, mode, key }, rowIndex) => {
                  const modeName = line.modeName ?? 'primary';
                  const damageEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_damage',
                    modeName,
                  );
                  const attackEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_attack',
                    modeName,
                  );
                  const accuracyEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_accuracy',
                    modeName,
                  );
                  const accuracy = (ranged?.acc ?? 0) + effectTotal(accuracyEffects);
                  const presets: readonly RollPreset[] = ranged
                    ? [
                        ...(ranged.acc != null || accuracyEffects.length > 0
                          ? [
                              {
                                label: `Aim (${accuracy >= 0 ? '+' : ''}${accuracy})`,
                                mod: accuracy,
                              },
                            ]
                          : []),
                        ...RANGE_PRESETS,
                        ...locationPresets,
                      ]
                    : locationPresets;
                  const firstOfLine = rows[rowIndex - 1]?.line.key !== line.key;
                  const showSkill =
                    rowIndex === 0 ||
                    (firstOfLine &&
                      line.modeName &&
                      (attackEffects.length > 0 ||
                        accuracyEffects.length > 0 ||
                        primaryAttackEffects.length > 0 ||
                        primaryAccuracyEffects.length > 0));
                  const attackLabel =
                    resolution.kind === 'matched'
                      ? `${resolution.name}${line.modeName ? ` · ${line.modeName}` : ''}`
                      : '';
                  const finalTarget =
                    resolution.kind === 'matched'
                      ? resolution.level - stPenalty + effectTotal(attackEffects)
                      : 0;
                  const resolved = mode ? resolveDamage(mode, thrust, swing) : null;
                  const finalDice = resolved
                    ? { ...resolved.dice, adds: resolved.dice.adds + effectTotal(damageEffects) }
                    : null;
                  const dice = finalDice ? formatDamageDice(finalDice) : null;
                  const effectiveDivisor = w.effectiveArmorDivisor ?? resolved?.armorDivisor;
                  const divisor = effectiveDivisor ? ` (${effectiveDivisor})` : '';
                  return (
                    <tr key={key} className="border-0">
                      {rowIndex === 0 && preferences.sort === 'custom' && (
                        <td rowSpan={rows.length} className="align-top px-1">
                          <DragHandle
                            aria-label={`Reorder attack ${weaponIndex + 1}`}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', w.id);
                              event.dataTransfer.effectAllowed = 'move';
                              setDraggingId(w.id);
                            }}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDropTarget(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                              event.preventDefault();
                              const target =
                                sortedWeapons[weaponIndex + (event.key === 'ArrowUp' ? -1 : 1)];
                              if (target) moveWeapon(w.id, target.id);
                            }}
                          />
                        </td>
                      )}
                      {rowIndex === 0 && (
                        <th
                          scope="rowgroup"
                          rowSpan={rows.length}
                          className="min-w-32 max-w-64 align-top font-normal"
                        >
                          <span className="block font-medium">{w.name}</span>
                          {stPenalty > 0 && (
                            <span className="badge badge-warning badge-outline badge-xs mt-1 whitespace-nowrap">
                              ST {wd.stRequired} (−{stPenalty})
                            </span>
                          )}
                          {ranged && rangedStatLine(ranged) !== '' && (
                            <p className="num mt-1 text-[11px] text-base-content/50">
                              {rangedStatLine(ranged)}
                            </p>
                          )}
                        </th>
                      )}
                      <td className="align-top">
                        {showSkill &&
                          (resolution.kind === 'matched' ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm h-auto min-h-8 gap-2 px-2 py-1 text-left font-normal"
                                onClick={() =>
                                  openRoll({
                                    label: attackLabel,
                                    baseTarget: finalTarget,
                                    presets,
                                  })
                                }
                              >
                                <span className="max-w-40 text-xs">{attackLabel}</span>
                                <span className="num text-base font-bold">{finalTarget}</span>
                              </button>
                              {stPenalty > 0 && (
                                <span className="mt-1 block text-[11px] text-base-content/50">
                                  {resolution.level} − {stPenalty} ST
                                </span>
                              )}
                              <ModifierBreakdown
                                baseLabel="Skill after ST"
                                baseValue={resolution.level - stPenalty - effectTotal(skillEffects)}
                                globalEffects={skillEffects}
                                weaponEffects={attackEffects}
                                finalValue={finalTarget}
                              />
                              {ranged && (
                                <ModifierBreakdown
                                  baseLabel="Accuracy"
                                  baseValue={ranged.acc ?? 0}
                                  weaponEffects={accuracyEffects}
                                  finalValue={accuracy}
                                />
                              )}
                            </>
                          ) : resolution.kind === 'missing' ? (
                            <p className="max-w-44 text-xs text-base-content/50">
                              Skill '{resolution.skillName}' not on sheet — add it in the Skills
                              tab.
                            </p>
                          ) : (
                            <p className="text-xs text-base-content/50">
                              No matching skill on sheet.
                            </p>
                          ))}
                      </td>
                      <td className="whitespace-nowrap">
                        {line.modeName && (
                          <span className="mb-0.5 block text-[10px] text-base-content/50">
                            {line.modeName}
                          </span>
                        )}
                        {resolved && finalDice ? (
                          <button
                            type="button"
                            className="btn btn-sm num h-8 min-h-8 px-2"
                            aria-label={`${dice}${resolved.type ? ` ${resolved.type}` : ''}${divisor}`}
                            onClick={() =>
                              openRoll({
                                label: line.modeName
                                  ? `${w.name} (${line.modeName}) damage`
                                  : `${w.name} damage`,
                                baseTarget: 0,
                                damage: {
                                  dice: finalDice,
                                  damageType: resolved.type,
                                  armorDivisor:
                                    effectiveDivisor == null ? null : String(effectiveDivisor),
                                },
                              })
                            }
                          >
                            {dice}
                            {divisor}
                          </button>
                        ) : (
                          <span className="text-xs text-base-content/60">
                            {mode?.raw ?? line.damage ?? '—'}
                          </span>
                        )}
                        {resolved && finalDice && (
                          <ModifierBreakdown
                            baseLabel="Parsed damage"
                            baseValue={formatDamageDice(resolved.dice)}
                            weaponEffects={damageEffects}
                            finalValue={formatDamageDice(finalDice)}
                          />
                        )}
                      </td>
                      <td className="num text-xs text-base-content/70">{mode?.type ?? '—'}</td>
                      <td className="num whitespace-nowrap text-xs text-base-content/70">
                        {line.reach ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </FoldSection>
  );
}
