import { useState } from 'react';
import { formatDamageDice, parseDerivedDamage } from '../../../../../shared/constants/damage.ts';
import { convertsDamageAddsToDice } from '../../../../../shared/domain/campaignRules.ts';
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
import { availableEquipment } from '../../../../../shared/domain/inventoryAvailability.ts';
import { formatRangedRange, resolveRangedRange } from '../../../../../shared/domain/rangedRange.ts';
import {
  weaponDamageBases,
  weaponStrengthKind,
} from '../../../../../shared/domain/weaponDamage.ts';
import { weaponModes } from '../../../../../shared/domain/weaponModes.ts';
import type { RangedData, WeaponData } from '../../../../../shared/schemas/inventory.ts';
import { DragHandle } from '../../../../components/ui/DragHandle.tsx';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import { Table, TableBody, TableHeader } from '../../../../components/ui/Table.tsx';
import { InventoryAnchorLink } from '../../InventoryAnchorLink.tsx';
import { mechanicsUnavailableReason } from '../../mechanicsUnavailableReason.ts';
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import type { RollRequest } from '../rollTypes.ts';
import {
  type AttackSort,
  type AttackTablePreferences,
  readAttackTablePreferences,
  saveAttackTablePreferences,
} from './attackTablePreferences.ts';
import {
  type ModifierSection,
  ModifierTooltip,
  WeaponEffectDiagnostics,
  effectTotal,
  hasModifierEffects,
  skillEffectsForRow,
  weaponEffectsForRow,
} from './weaponEffectView.tsx';

/** "Acc 3 · 100/150 · RoF 1 · Shots 9+1(3) · Bulk −4 · Rcl 2" from present fields only. */
function rangedStatLine(r: RangedData): string {
  const parts: string[] = [];
  if (r.acc != null) parts.push(`Acc ${r.acc}`);
  if (r.range) parts.push(formatRangedRange(r.range) ?? '');
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
  readonly modeKey?: string;
  readonly weaponMode?: ReturnType<typeof weaponModes>[number];
  readonly key: string;
  readonly modeName: string | null;
  readonly damage: string | undefined;
  readonly reach: string | null | undefined;
}

function damageLinesFor(weaponName: string, wd: WeaponData): DamageLine[] {
  const lines: DamageLine[] = weaponModes(wd).map((mode, i) => ({
    key: `${weaponName}:mode:${mode.key}`,
    modeKey: mode.key,
    modeName: i === 0 && mode.name === 'Primary' ? null : mode.name,
    damage: mode.damage,
    reach: mode.reach,
    weaponMode: mode,
  }));
  // A weapon whose primary line carries no damage at all (alternates-only
  // data entry) shouldn't render an empty leading row.
  return lines.filter((line, i) => i > 0 || line.damage !== undefined || lines.length === 1);
}

/*
 * Below 640px each attack row becomes a four-column grid (handle gutter, skill,
 * damage, ±): the weapon name takes the group's first line and Reach / Range
 * drops to a muted line under its attack. The table elements keep their native
 * roles; only their display changes.
 */
const CELL = 'border-0 px-1.5 py-0.5 align-top';
/** In the separated-border table model the group rule is drawn on the first row's cells. */
const GROUP_RULE = 'sm:border-t sm:border-base-300/60';
const ROW =
  'border-0 max-sm:grid max-sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(6rem,auto)_1.75rem] max-sm:items-start';

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

  function sortBy(sort: Exclude<AttackSort, 'custom'>) {
    save({
      ...preferences,
      sort,
      descending: sort === preferences.sort ? !preferences.descending : false,
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
  const weapons = availableEquipment(character.inventory).filter((i) => i.weaponData != null);
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

  /**
   * Moving a weapon returns the table to custom order, starting from the order
   * currently on screen so a sorted view becomes the new custom order.
   */
  function moveWeapon(id: string, targetId: string) {
    const visible = sortedWeapons.map((weapon) => weapon.id);
    const from = visible.indexOf(id);
    const to = visible.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...visible];
    next.splice(from, 1);
    next.splice(to, 0, id);
    // Keep unequipped IDs so putting a weapon away does not discard its preference.
    const hiddenIds = preferences.order.filter((savedId) => !visible.includes(savedId));
    save({ order: [...next, ...hiddenIds], sort: 'custom', descending: false });
    setAnnouncement(
      `${weapons.find((weapon) => weapon.id === id)?.name ?? 'Attack'} moved to position ${to + 1}.`,
    );
  }

  function sortHeader(
    label: string,
    sort: Exclude<AttackSort, 'custom'>,
    className = '',
    phoneLabel?: string,
  ) {
    const active = preferences.sort === sort;
    return (
      <TableHeader
        column={sort}
        label={label}
        scope="col"
        className={`px-1.5 ${className}`}
        aria-sort={active ? (preferences.descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs -ml-1 h-auto min-h-0 whitespace-nowrap px-1 py-1 font-semibold"
          aria-label={phoneLabel ? label : undefined}
          onClick={() => sortBy(sort)}
        >
          {phoneLabel ? (
            <>
              <span className="max-sm:hidden">{label}</span>
              <span className="sm:hidden">{phoneLabel}</span>
            </>
          ) : (
            label
          )}{' '}
          <span aria-hidden="true">{active ? (preferences.descending ? '↓' : '↑') : '↕'}</span>
        </button>
      </TableHeader>
    );
  }

  if (weapons.length === 0) {
    return (
      <FoldSection preferenceKey={`${character.id}:AttacksCard`} title="Attacks" icon="combat">
        <p className="text-sm text-base-content/60">No equipped weapons.</p>
      </FoldSection>
    );
  }

  return (
    <FoldSection preferenceKey={`${character.id}:AttacksCard`} title="Attacks" icon="combat">
      {saveFailed && (
        <output className="text-xs text-warning">
          This browser could not save the attack order. It will reset when you leave this page.
        </output>
      )}
      <output className="sr-only">{announcement}</output>
      {!effectsKnown && (
        <p className="text-xs text-warning">
          ST-based damage is unavailable until linked library effects load.{' '}
          {mechanicsUnavailableReason(character)}
        </p>
      )}
      <WeaponEffectDiagnostics
        effects={effects.filter((effect) =>
          ['weapon_attack', 'weapon_damage', 'weapon_accuracy'].includes(effect.target),
        )}
        inventory={character.inventory}
      />
      <div className="overflow-x-auto">
        <Table
          preferenceKey={`${character.id}:attacks`}
          aria-label="Attacks"
          className="table table-sm w-full max-sm:block"
        >
          <caption className="sr-only">Equipped weapon attacks.</caption>
          <thead className="max-sm:block">
            <tr className="max-sm:flex max-sm:items-center">
              <th scope="col" className="w-8 px-1 max-sm:w-6 max-sm:shrink-0 max-sm:px-0">
                <span className="sr-only">Custom order</span>
              </th>
              {sortHeader('Weapon', 'weapon', 'sm:w-32 md:w-40 lg:w-56')}
              {sortHeader('Governing skill', 'skill', 'sm:w-48 lg:w-64', 'Skill')}
              <TableHeader
                column="damage"
                label="Damage"
                className="px-1.5 text-right max-sm:ml-auto sm:w-20"
              />
              {sortHeader('Type', 'type', 'max-sm:hidden sm:w-12')}
              <th scope="col" className="w-9 px-1 max-sm:hidden">
                <span className="sr-only">Modifiers</span>
              </th>
              <TableHeader
                column="reach"
                label="Reach / Range"
                className="px-1.5 whitespace-nowrap max-sm:hidden"
              />
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

            const rows = parsedByLine.flatMap(({ line, modes }) =>
              (modes.length ? modes : [null]).map((mode, index) => ({
                line,
                mode,
                key: `${line.key}:${index}`,
              })),
            );
            return (
              <TableBody
                filterValues={{
                  weapon: w.name,
                  skill: lines.map((line) => {
                    const skill = line.weaponMode ? line.weaponMode.skill : wd.skill;
                    const resolution = resolveWeaponSkill(w.name, skill, skillCandidates);
                    return resolution.kind === 'matched' ? resolution.name : (skill ?? '—');
                  }),
                  type: allModes.length
                    ? [...new Set(allModes.map((mode) => mode.type ?? '—'))]
                    : ['—'],
                  damage: rows.map(({ line, mode }) => {
                    if (!mode) return line.damage ?? '—';
                    const bases = weaponDamageBases(
                      line.weaponMode,
                      character.derived.effectiveSt,
                      thrust,
                      swing,
                    );
                    const damageEffects = weaponEffectsForRow(
                      effects,
                      w.id,
                      'weapon_damage',
                      line.modeName ?? 'primary',
                      line.modeKey,
                      line.weaponMode ? (line.weaponMode.skill ?? null) : (wd.skill ?? null),
                    );
                    const resolved = resolveDamage(mode, bases.thrust, bases.swing, {
                      flatBonus: effectTotal(damageEffects),
                      convertAddsToDice: convertsDamageAddsToDice(character.houseRules),
                    });
                    return resolved ? formatDamageDice(resolved.dice) : (line.damage ?? '—');
                  }),
                  reach: lines.map((line) => line.reach ?? '—'),
                }}
                key={w.id}
                aria-label={w.name}
                className={`max-sm:block max-sm:border-t max-sm:border-base-300/60 max-sm:py-1 ${draggingId === w.id ? 'opacity-40' : ''} ${dropTarget === w.id ? 'bg-base-200' : ''}`}
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
                  const canHitVitals = mode === null || canTargetVitals(mode.type);
                  const currentMode = line.weaponMode;
                  const ranged = currentMode?.ranged;
                  const resolution = resolveWeaponSkill(
                    w.name,
                    currentMode ? currentMode.skill : wd.skill,
                    skillCandidates,
                  );
                  const stPenalty = stShortfallPenalty(
                    currentMode &&
                      weaponStrengthKind(currentMode) === 'crossbow' &&
                      currentMode.weaponSt == null
                      ? null
                      : currentMode?.stRequired,
                    state.strength(character.derived.effectiveSt),
                  );
                  const skillEffects =
                    resolution.kind === 'matched'
                      ? skillEffectsForRow(effects, resolution.name)
                      : [];
                  const damageEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_damage',
                    modeName,
                    line.modeKey,
                    currentMode ? (currentMode.skill ?? null) : (wd.skill ?? null),
                  );
                  const attackEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_attack',
                    modeName,
                    line.modeKey,
                    currentMode ? (currentMode.skill ?? null) : (wd.skill ?? null),
                  );
                  const accuracyEffects = weaponEffectsForRow(
                    effects,
                    w.id,
                    'weapon_accuracy',
                    modeName,
                    line.modeKey,
                    currentMode ? (currentMode.skill ?? null) : (wd.skill ?? null),
                  );
                  const accuracy = (ranged?.acc ?? 0) + effectTotal(accuracyEffects);
                  const firstOfLine = rows[rowIndex - 1]?.line.key !== line.key;
                  const showSkill = firstOfLine;
                  const attackLabel =
                    resolution.kind === 'matched'
                      ? `${resolution.name}${line.modeName ? ` · ${line.modeName}` : ''}`
                      : '';
                  const bowTooStrong =
                    currentMode &&
                    weaponStrengthKind(currentMode) === 'bow' &&
                    (currentMode.weaponSt ?? currentMode.stRequired ?? 0) >
                      state.strength(character.derived.effectiveSt);
                  const finalTarget =
                    resolution.kind === 'matched' && !bowTooStrong
                      ? resolution.level - stPenalty + effectTotal(attackEffects)
                      : 0;
                  const bases = weaponDamageBases(
                    currentMode,
                    character.derived.effectiveSt,
                    thrust,
                    swing,
                  );
                  const resolved = mode
                    ? resolveDamage(mode, bases.thrust, bases.swing, {
                        flatBonus: effectTotal(damageEffects),
                        convertAddsToDice: convertsDamageAddsToDice(character.houseRules),
                      })
                    : null;
                  const finalDice = resolved?.dice ?? null;
                  const dice = finalDice ? formatDamageDice(finalDice) : null;
                  const effectiveDivisor = w.effectiveArmorDivisor ?? resolved?.armorDivisor;
                  const divisor = effectiveDivisor ? ` (${effectiveDivisor})` : '';

                  const modifierSections: ModifierSection[] = [];
                  if (showSkill && resolution.kind === 'matched') {
                    const attackBreakdown = {
                      baseLabel: 'Skill after ST',
                      baseValue: resolution.level - stPenalty - effectTotal(skillEffects),
                      globalEffects: skillEffects,
                      weaponEffects: attackEffects,
                      finalValue: finalTarget,
                    };
                    if (stPenalty > 0 || hasModifierEffects(attackBreakdown)) {
                      modifierSections.push({
                        title: 'Attack',
                        ...(stPenalty > 0
                          ? {
                              note: `${resolution.level} − ${stPenalty} ST (B270)`,
                            }
                          : {}),
                        breakdown: attackBreakdown,
                      });
                    }
                    const accuracyBreakdown = {
                      baseLabel: 'Accuracy',
                      baseValue: ranged?.acc ?? 0,
                      weaponEffects: accuracyEffects,
                      finalValue: accuracy,
                    };
                    if (ranged && hasModifierEffects(accuracyBreakdown)) {
                      modifierSections.push({ title: 'Accuracy', breakdown: accuracyBreakdown });
                    }
                  }
                  if (resolved && finalDice && damageEffects.length > 0) {
                    modifierSections.push({
                      title: 'Damage',
                      breakdown: {
                        baseLabel: 'Parsed damage',
                        baseValue: formatDamageDice({
                          ...resolved.unconvertedDice,
                          adds: resolved.unconvertedDice.adds - effectTotal(damageEffects),
                        }),
                        weaponEffects: damageEffects,
                        finalValue: formatDamageDice(finalDice),
                      },
                    });
                  }

                  const first = rowIndex === 0;
                  const rule = first ? GROUP_RULE : '';
                  const lineRow = first ? 'max-sm:row-start-2' : 'max-sm:row-start-1';
                  const rangeRow = first ? 'max-sm:row-start-3' : 'max-sm:row-start-2';
                  const rangeText =
                    firstOfLine && ranged ? (
                      rangedStatLine(ranged)
                    ) : firstOfLine && line.reach ? (
                      <>
                        <span className="sm:hidden">Reach </span>
                        {line.reach}
                      </>
                    ) : null;
                  const modeLabel = line.modeName && (
                    <span className="order-first font-semibold text-base-content">
                      {line.modeName}
                    </span>
                  );
                  return (
                    <tr key={key} className={ROW}>
                      {first && (
                        <td
                          rowSpan={rows.length}
                          className={`border-0 px-1 py-0.5 align-top max-sm:col-start-1 max-sm:row-start-1 max-sm:p-0 ${rule}`}
                        >
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
                      {first && (
                        <th
                          scope="rowgroup"
                          rowSpan={rows.length}
                          className={`${CELL} ${rule} pt-2 font-normal max-sm:col-span-3 max-sm:col-start-2 max-sm:row-start-1 max-sm:pt-1 max-sm:pb-0`}
                        >
                          <InventoryAnchorLink
                            itemId={w.id}
                            className="link link-hover block font-semibold [overflow-wrap:anywhere] sm:max-w-32 md:max-w-40 lg:max-w-56"
                          >
                            {w.name}
                          </InventoryAnchorLink>
                        </th>
                      )}
                      <td
                        className={`${CELL} ${rule} max-sm:col-span-2 max-sm:col-start-1 max-sm:pl-3 ${lineRow}`}
                      >
                        {showSkill &&
                          (resolution.kind === 'matched' ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm h-auto min-h-7 w-full flex-nowrap justify-between gap-1.5 px-1.5 py-0 max-sm:px-1 text-left font-normal"
                              disabled={bowTooStrong}
                              onClick={() =>
                                openRoll({
                                  label: attackLabel,
                                  baseTarget: finalTarget,
                                  attack: {
                                    ranged: !!ranged,
                                    range: resolveRangedRange(
                                      ranged?.range,
                                      state.strength(character.derived.effectiveSt),
                                      currentMode?.weaponSt ?? currentMode?.stRequired,
                                    ),
                                    accuracy,
                                    canTargetVitals: canHitVitals,
                                  },
                                })
                              }
                            >
                              {/* Mode reads first; the accessible name keeps "Skill · Mode N". */}
                              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
                                <span className="min-w-0 break-words text-xs text-base-content/70">
                                  {resolution.name}
                                </span>
                                {line.modeName && (
                                  <>
                                    <span className="sr-only"> · </span>
                                    {modeLabel}
                                  </>
                                )}
                              </span>{' '}
                              <span className="num shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-base font-bold text-primary">
                                {finalTarget}
                              </span>
                            </button>
                          ) : (
                            <p className="flex flex-wrap items-baseline gap-x-1.5 px-1.5 py-1.5 text-xs text-base-content/70">
                              {modeLabel}
                              <span>
                                {resolution.kind === 'missing'
                                  ? `Skill '${resolution.skillName}' not on sheet.`
                                  : 'No matching skill on sheet.'}
                              </span>
                            </p>
                          ))}
                        {firstOfLine && (stPenalty > 0 || bowTooStrong) && (
                          <p className="px-1.5 text-[11px] font-medium text-warning">
                            {bowTooStrong
                              ? 'Bow ST exceeds usable ST (B275)'
                              : `ST ${currentMode?.stRequired} (−${stPenalty})`}
                          </p>
                        )}
                      </td>
                      <td
                        className={`${CELL} ${rule} text-right whitespace-nowrap max-sm:col-start-3 ${lineRow}`}
                      >
                        {resolved && finalDice ? (
                          <button
                            type="button"
                            className="btn btn-sm num h-7 min-h-7 px-2 text-base font-bold"
                            aria-label={`${dice}${resolved.type ? ` ${resolved.type}` : ''}${divisor}`}
                            onClick={() =>
                              openRoll({
                                label: line.modeName
                                  ? `${w.name} (${line.modeName}) damage`
                                  : `${w.name} damage`,
                                baseTarget: 0,
                                damage: {
                                  dice: finalDice,
                                  ...(convertsDamageAddsToDice(character.houseRules)
                                    ? { unconvertedDice: resolved.unconvertedDice }
                                    : {}),
                                  damageType: resolved.type,
                                  armorDivisor:
                                    effectiveDivisor == null ? null : String(effectiveDivisor),
                                },
                              })
                            }
                          >
                            {dice}
                            {resolved.type && (
                              <span className="text-xs font-normal text-base-content/70 sm:hidden">
                                {resolved.type}
                              </span>
                            )}
                            {divisor && <span className="font-normal">{divisor}</span>}
                          </button>
                        ) : (
                          <span className="inline-block py-1.5 text-xs whitespace-normal text-base-content/70">
                            {mode?.raw ?? line.damage ?? '—'}
                          </span>
                        )}
                      </td>
                      <td
                        className={`${CELL} ${rule} pt-2 text-xs text-base-content/70 max-sm:hidden`}
                      >
                        {mode?.type ?? '—'}
                      </td>
                      <td
                        className={`border-0 px-1 py-0.5 align-top max-sm:col-start-4 max-sm:px-0 ${rule} ${lineRow} ${modifierSections.length ? '' : 'max-sm:hidden'}`}
                      >
                        <ModifierTooltip
                          label={`Modifiers: ${w.name}${line.modeName ? `, ${line.modeName}` : ''}`}
                          sections={modifierSections}
                        />
                      </td>
                      <td
                        className={`${CELL} ${rule} pt-2 text-xs text-base-content/70 max-sm:col-span-4 max-sm:col-start-1 max-sm:pt-0 max-sm:pb-1 max-sm:pl-4 ${rangeRow} ${rangeText ? '' : 'max-sm:hidden'}`}
                      >
                        {rangeText ?? (firstOfLine ? '—' : null)}
                      </td>
                    </tr>
                  );
                })}
              </TableBody>
            );
          })}
        </Table>
      </div>
    </FoldSection>
  );
}
