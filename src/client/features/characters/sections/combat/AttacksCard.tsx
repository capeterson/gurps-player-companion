import { damageForSt, formatDamageDice } from '../../../../../shared/constants/damage.ts';
import {
  HIT_LOCATIONS,
  HIT_LOCATION_AIM_PENALTY,
  type HitLocation,
} from '../../../../../shared/constants/hitLocations.ts';
import {
  canTargetVitals,
  parseDamageSpec,
  resolveDamage,
} from '../../../../../shared/domain/damageParse.ts';
import { matchSkillForWeapon } from '../../../../../shared/domain/defenseCalc.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
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
  const skillCandidates = character.skills.map((s) => ({ name: s.name, level: s.level }));

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
          const damageDisplay =
            modes.length > 0
              ? modes
                  .map((m) => {
                    const resolved = resolveDamage(m, thrust, swing);
                    if (!resolved) return m.raw;
                    const dice = formatDamageDice(resolved.dice);
                    const type = resolved.type ? ` ${resolved.type}` : '';
                    const divisor = resolved.armorDivisor ? ` (${resolved.armorDivisor})` : '';
                    return `${dice}${type}${divisor}`;
                  })
                  .join(' / ')
              : (wd.damage ?? '—');
          const stWarn = wd.stRequired != null && wd.stRequired > character.derived.effectiveSt;
          const matched = matchSkillForWeapon(w.name, skillCandidates);
          // Only offer the vitals/eye presets when at least one of the
          // weapon's parsed damage modes can target them (B399). A
          // weapon with no parseable modes at all (free-text homebrew
          // damage) keeps the full preset list rather than being
          // punished for not parsing.
          const canHitVitals = modes.length === 0 || modes.some((m) => canTargetVitals(m.type));
          const hitLocationPresets = canHitVitals
            ? HIT_LOCATION_PRESETS
            : HIT_LOCATION_PRESETS_NO_VITALS;

          return (
            <div key={w.id} className="space-y-1.5 rounded-lg border border-base-300/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{w.name}</span>
                {stWarn && (
                  <span className="badge badge-warning badge-outline text-[10px]">
                    ST {wd.stRequired}
                  </span>
                )}
              </div>
              <p className="num text-xs text-base-content/70">
                {damageDisplay}
                {wd.reach ? ` · reach ${wd.reach}` : ''}
              </p>
              {matched ? (
                <RollableRow
                  label={matched.name}
                  baseTarget={matched.level}
                  presets={hitLocationPresets}
                  openRoll={openRoll}
                />
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
