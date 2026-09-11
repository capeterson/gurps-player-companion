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
import type { EffectAwareCharacterDetail as CharacterDetail } from '../../useCharacterDetail.ts';
import { RollableRow } from '../RollableRow.tsx';
import type { RollPreset, RollRequest } from '../rollTypes.ts';

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

  if (weapons.length === 0) {
    return (
      <section className="card space-y-2 p-5">
        <p className="label-eyebrow">Attacks</p>
        <p className="text-sm text-base-content/60">
          No equipped weapons — equip items in the Inventory tab.
        </p>
      </section>
    );
  }

  return (
    <section className="card space-y-3 p-5">
      <p className="label-eyebrow">Attacks</p>
      {!effectsKnown && (
        <p className="text-xs text-warning">
          ST-based damage is unavailable until linked library effects load.
        </p>
      )}
      <div className="space-y-3">
        {weapons.map((w) => {
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
          const presets: readonly RollPreset[] = ranged
            ? [
                ...(ranged.acc != null ? [{ label: `Aim (+${ranged.acc})`, mod: ranged.acc }] : []),
                ...RANGE_PRESETS,
                ...locationPresets,
              ]
            : locationPresets;

          return (
            <div key={w.id} className="space-y-1.5 rounded-lg border border-base-300/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{w.name}</span>
                {stPenalty > 0 && (
                  <span className="badge badge-warning badge-outline text-[10px]">
                    ST {wd.stRequired} (−{stPenalty})
                  </span>
                )}
              </div>
              {parsedByLine.map(({ line, modes }) => (
                <div
                  key={line.key}
                  className="num flex flex-wrap items-center gap-1.5 text-xs text-base-content/70"
                >
                  {line.modeName && <span className="label-eyebrow not-num">{line.modeName}</span>}
                  {modes.length > 0 ? (
                    modes.map((m) => {
                      const resolved = resolveDamage(m, thrust, swing);
                      if (!resolved) return <span key={`${line.key}:${m.raw}`}>{m.raw}</span>;
                      const dice = formatDamageDice(resolved.dice);
                      const type = resolved.type ? ` ${resolved.type}` : '';
                      const divisor = resolved.armorDivisor ? ` (${resolved.armorDivisor})` : '';
                      const display = `${dice}${type}${divisor}`;
                      const rollLabel = line.modeName
                        ? `${w.name} (${line.modeName}) damage`
                        : `${w.name} damage`;
                      return (
                        <button
                          key={`${line.key}:${m.raw}`}
                          type="button"
                          className="chip"
                          onClick={() =>
                            openRoll({
                              label: rollLabel,
                              baseTarget: 0,
                              damage: {
                                dice: resolved.dice,
                                damageType: resolved.type,
                                armorDivisor: resolved.armorDivisor,
                              },
                            })
                          }
                        >
                          {display}
                        </button>
                      );
                    })
                  ) : (
                    <span>{line.damage ?? '—'}</span>
                  )}
                  {line.reach ? <span>· reach {line.reach}</span> : null}
                </div>
              ))}
              {ranged && rangedStatLine(ranged) !== '' && (
                <p className="num text-xs text-base-content/70">{rangedStatLine(ranged)}</p>
              )}
              {resolution.kind === 'matched' ? (
                <RollableRow
                  label={resolution.name}
                  baseTarget={resolution.level - stPenalty}
                  presets={presets}
                  openRoll={openRoll}
                  sublabel={
                    stPenalty > 0 ? (
                      <span className="block text-[11px] text-base-content/60">
                        {resolution.name} {resolution.level} − {stPenalty} ST
                      </span>
                    ) : undefined
                  }
                />
              ) : resolution.kind === 'missing' ? (
                <p className="text-[11px] text-base-content/50">
                  Skill '{resolution.skillName}' not on sheet — add it in the Skills tab.
                </p>
              ) : (
                <p className="text-[11px] text-base-content/50">No matching skill on sheet.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
