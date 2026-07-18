/**
 * GURPS 4e active defense math (Basic Set p. 374-376).
 *
 *   - Dodge = floor(Basic Speed) + 3 (B17), then encumbrance applies a
 *     penalty (B17). `encumbrance.ts`'s `dodgePenalty` is stored as a
 *     negative or zero number (e.g. -2 for Medium encumbrance), so
 *     it's simply added here. RAW gives no floor for encumbered Dodge —
 *     the min-1 rules in the book apply to Move under encumbrance (B17)
 *     and to Move/Dodge halved by low FP/HP (B426/B419), not to
 *     encumbrance's effect on Dodge itself — so this does not clamp the
 *     result.
 *   - Parry = floor(skill/2) + 3 + weapon parry modifier (B376).
 *   - Block = floor(skill/2) + 3 (B375).
 */

import type { WeaponData } from '../schemas/inventory.ts';

/** Dodge after encumbrance (B17). `encumbrancePenalty` must be <= 0. */
export function effectiveDodge(dodge: number, encumbrancePenalty: number): number {
  return dodge + encumbrancePenalty;
}

/** Parry score from a weapon skill level and the weapon's parry modifier (B376). */
export function parryFromSkill(skillLevel: number, weaponParryMod: number): number {
  return Math.floor(skillLevel / 2) + 3 + weaponParryMod;
}

/** Block score from a shield/weapon skill level (B375). */
export function blockFromSkill(skillLevel: number): number {
  return Math.floor(skillLevel / 2) + 3;
}

export type ParsedParry =
  | {
      readonly kind: 'parry';
      readonly mod: number;
      /** 'F' suffix (fencing weapon, B376). The improved retreat bonus is
       *  situational and intentionally not modeled — noted for display. */
      readonly fencing: boolean;
      /** 'U' suffix or bare 'U' (unbalanced, B270): the weapon still
       *  parries, just not on a turn it attacked. That turn-state nuance
       *  is not tracked, so the flag is reserved for future UI. */
      readonly unbalanced: boolean;
    }
  | {
      /** 'No' — the weapon cannot parry at all (B270). */
      readonly kind: 'no';
    };

/**
 * Parse a weapon "parry" field (e.g. from weaponData.parry) into its
 * GURPS 4e notation forms: a signed modifier ('0', '+2', '-1'),
 * optionally suffixed with 'F' (fencing) or 'U' (unbalanced), a bare
 * 'U' (unbalanced with implicit 0), or 'No' (cannot parry).
 *
 * Returns null only for empty/missing input or notation that doesn't
 * match any known form (the caller falls back to displaying the raw
 * string as-is — lenient by contract, this is player-typed free text).
 */
export function parseParryString(raw: string | null | undefined): ParsedParry | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^no$/i.test(trimmed)) return { kind: 'no' };
  if (/^u$/i.test(trimmed)) return { kind: 'parry', mod: 0, fencing: false, unbalanced: true };
  const match = trimmed.match(/^([+-]?\d+)\s*([FU])?$/i);
  if (!match) return null;
  const suffix = (match[2] ?? '').toUpperCase();
  return {
    kind: 'parry',
    mod: Number.parseInt(match[1] as string, 10),
    fencing: suffix === 'F',
    unbalanced: suffix === 'U',
  };
}

export interface SkillCandidate {
  readonly name: string;
  readonly level: number | null;
}

export interface MatchedSkill {
  readonly name: string;
  readonly level: number;
}

/**
 * Display/match name for a skill row: "Guns (Pistol)" when a
 * specialization is set, else the bare name. Two skill rows can share
 * the same `name` with different `specialization` (e.g. "Guns"/Pistol
 * vs "Guns"/Rifle) — every `SkillCandidate` fed into
 * `matchSkillForWeapon` / `resolveWeaponSkill` should be built with
 * this so the two remain distinguishable, both in the weapon-skill
 * picker's suggestions and in what an explicit binding actually
 * matches against.
 */
export function skillDisplayName(name: string, specialization: string | null | undefined): string {
  const spec = specialization?.trim();
  return spec ? `${name} (${spec})` : name;
}

/**
 * Find the best skill on a character's sheet to use for a given
 * weapon's Parry/Block, matching by name. Exact (case-insensitive)
 * name matches win; failing that, a substring match either direction
 * (the weapon name contains the skill name, or vice versa) is used.
 * Skills with a null level (unusable/no default) are skipped. Ties
 * are broken by highest level, then alphabetically by skill name, so
 * the result is deterministic.
 */
function pickBest(
  candidates: readonly (SkillCandidate & { level: number })[],
): MatchedSkill | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return a.name.localeCompare(b.name);
  });
  const best = sorted[0] as SkillCandidate & { level: number };
  return { name: best.name, level: best.level };
}

export function matchSkillForWeapon(
  weaponName: string,
  skills: readonly SkillCandidate[],
): MatchedSkill | null {
  const weaponLower = weaponName.trim().toLowerCase();
  const usable = skills.filter((s): s is SkillCandidate & { level: number } => s.level !== null);

  const exact = usable.filter((s) => s.name.trim().toLowerCase() === weaponLower);
  const exactMatch = pickBest(exact);
  if (exactMatch) return exactMatch;

  const substring = usable.filter((s) => {
    const skillLower = s.name.trim().toLowerCase();
    return weaponLower.includes(skillLower) || skillLower.includes(weaponLower);
  });
  return pickBest(substring);
}

export type WeaponSkillResolution =
  | {
      readonly kind: 'matched';
      readonly name: string;
      readonly level: number;
      /** True when the weapon's explicit `skill` binding matched; false
       *  when the fuzzy name-match fallback found it. */
      readonly explicit: boolean;
    }
  | {
      /** An explicit skill is bound but no usable skill of that name is
       *  on the sheet. Deliberately NOT falling back to fuzzy matching:
       *  explicit means explicit, and an honest "not on sheet" beats a
       *  silently different skill. */
      readonly kind: 'missing';
      readonly skillName: string;
    }
  | {
      /** No explicit binding and the fuzzy fallback found nothing. */
      readonly kind: 'none';
    };

/**
 * Resolve the skill governing a weapon. An explicit binding
 * (weaponData.skill) is matched by exact case-insensitive name only;
 * when unset, falls back to `matchSkillForWeapon` on the weapon's name.
 */
export function resolveWeaponSkill(
  weaponName: string,
  explicitSkill: string | null | undefined,
  skills: readonly SkillCandidate[],
): WeaponSkillResolution {
  const explicit = explicitSkill?.trim();
  if (explicit) {
    const explicitLower = explicit.toLowerCase();
    const usable = skills.filter(
      (s): s is SkillCandidate & { level: number } =>
        s.level !== null && s.name.trim().toLowerCase() === explicitLower,
    );
    const best = pickBest(usable);
    if (best) return { kind: 'matched', name: best.name, level: best.level, explicit: true };
    return { kind: 'missing', skillName: explicit };
  }
  const fuzzy = matchSkillForWeapon(weaponName, skills);
  if (fuzzy) return { kind: 'matched', name: fuzzy.name, level: fuzzy.level, explicit: false };
  return { kind: 'none' };
}

/**
 * To-hit penalty for wielding a weapon below its minimum ST (B270):
 * -1 to weapon skill per point of ST shortfall. Returned as a
 * non-negative number the caller SUBTRACTS from the skill level.
 */
export function stShortfallPenalty(
  stRequired: number | null | undefined,
  effectiveSt: number,
): number {
  if (stRequired == null) return 0;
  return Math.max(0, stRequired - effectiveSt);
}

export interface ShieldItemRow {
  readonly equipped: boolean;
  readonly name: string;
  readonly weaponData: WeaponData | null;
}

export interface PickedShield {
  readonly name: string;
  readonly db: number;
  readonly weaponData: WeaponData;
}

/**
 * The character's active shield: the equipped item with a non-null
 * Defense Bonus (`weaponData.db`). Presence of `db` — not its
 * magnitude — is the shield marker (a DB 0 shield still blocks).
 * Several equipped shields: highest DB wins, ties broken by name for
 * determinism.
 */
export function pickShield(items: readonly ShieldItemRow[]): PickedShield | null {
  let best: PickedShield | null = null;
  for (const item of items) {
    const db = item.weaponData?.db;
    if (!item.equipped || item.weaponData == null || db == null) continue;
    if (
      best === null ||
      db > best.db ||
      (db === best.db && item.name.localeCompare(best.name) < 0)
    ) {
      best = { name: item.name, db, weaponData: item.weaponData };
    }
  }
  return best;
}
