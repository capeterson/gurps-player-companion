import { damageForSt, formatDamageDice } from '../../../../../shared/constants/damage.ts';
import {
  HIT_LOCATIONS,
  HIT_LOCATION_AIM_PENALTY,
  type HitLocation,
} from '../../../../../shared/constants/hitLocations.ts';
import { RANGE_PENALTY_STEPS } from '../../../../../shared/constants/rangePenalty.ts';
import {
  canTargetVitals,
  parseDamageSpec,
  resolveDamage,
} from '../../../../../shared/domain/damageParse.ts';
import {
  resolveWeaponSkill,
  stShortfallPenalty,
} from '../../../../../shared/domain/defenseCalc.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { RangedData } from '../../../../../shared/schemas/inventory.ts';
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

export interface AttacksCardProps {
  character: CharacterDetail;
  openRoll: (req: RollRequest) => void;
}

export function AttacksCard({ character, openRoll }: AttacksCardProps) {
  const weapons = character.inventory.filter((i) => i.equipped && i.weaponData != null);
  // Recomputed from effective ST rather than re-parsing character.derived's
  // already-formatted thrust/swing strings (e.g. "1d-2") — same table
  // (constants/damage.ts), one fewer round-trip through string parsing.
  const { thrust, swing } = damageForSt(character.derived.effectiveSt);
  // effectiveLevel folds in trait/skill effect bonuses (skillBonusFor) —
  // the same value SkillsPanel rolls against, so attack rolls agree.
  const skillCandidates = character.skills.map((s) => ({
    name: s.name,
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
      <div className="space-y-3">
        {weapons.map((w) => {
          const wd = w.weaponData;
          if (!wd) return null;
          const modes = wd.damage ? parseDamageSpec(wd.damage) : [];
          const stPenalty = stShortfallPenalty(wd.stRequired, character.derived.effectiveSt);
          const resolution = resolveWeaponSkill(w.name, wd.skill, skillCandidates);
          // Only offer the vitals/eye presets when at least one of the
          // weapon's parsed damage modes can target them (B399). A
          // weapon with no parseable modes at all (free-text homebrew
          // damage) keeps the full preset list rather than being
          // punished for not parsing.
          const canHitVitals = modes.length === 0 || modes.some((m) => canTargetVitals(m.type));
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
              <div className="num flex flex-wrap items-center gap-1.5 text-xs text-base-content/70">
                {modes.length > 0 ? (
                  modes.map((m) => {
                    const resolved = resolveDamage(m, thrust, swing);
                    if (!resolved) return <span key={m.raw}>{m.raw}</span>;
                    const dice = formatDamageDice(resolved.dice);
                    const type = resolved.type ? ` ${resolved.type}` : '';
                    const divisor = resolved.armorDivisor ? ` (${resolved.armorDivisor})` : '';
                    const display = `${dice}${type}${divisor}`;
                    return (
                      <button
                        key={m.raw}
                        type="button"
                        className="chip"
                        onClick={() =>
                          openRoll({
                            label: `${w.name} damage`,
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
                  <span>{wd.damage ?? '—'}</span>
                )}
                {wd.reach ? <span>· reach {wd.reach}</span> : null}
              </div>
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
