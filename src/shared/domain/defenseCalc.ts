/**
 * GURPS 4e active defense math (Basic Set p. 374-376).
 *
 *   - Dodge = floor(Basic Speed) + 3 (B17), then encumbrance applies a
 *     penalty (B17, B419). `encumbrance.ts`'s `dodgePenalty` is stored
 *     as a negative or zero number (e.g. -2 for Medium encumbrance),
 *     so it's simply added here; the result is floored at 1 (a
 *     character can never have less than Dodge 1).
 *   - Parry = floor(skill/2) + 3 + weapon parry modifier (B376).
 *   - Block = floor(skill/2) + 3 (B375).
 */

/** Dodge after encumbrance, floored at 1 (B17/B419). `encumbrancePenalty` must be <= 0. */
export function effectiveDodge(dodge: number, encumbrancePenalty: number): number {
  return Math.max(1, dodge + encumbrancePenalty);
}

/** Parry score from a weapon skill level and the weapon's parry modifier (B376). */
export function parryFromSkill(skillLevel: number, weaponParryMod: number): number {
  return Math.floor(skillLevel / 2) + 3 + weaponParryMod;
}

/** Block score from a shield/weapon skill level (B375). */
export function blockFromSkill(skillLevel: number): number {
  return Math.floor(skillLevel / 2) + 3;
}

export interface ParsedParry {
  readonly mod: number;
}

/**
 * Parse a library "parry" field (e.g. from weaponData.parry) into a
 * signed modifier. Accepts '0', '+2', '-1'. Returns null for 'No'
 * (weapon cannot parry), 'U' (unbalanced weapons default to 'U' or a
 * trailing 'U'/'F' flag), an empty/missing string, or anything else
 * that doesn't parse cleanly to a bare signed integer.
 *
 * Trailing-letter forms like '0F' (fencing weapon, no retreat bonus)
 * or '0U' (unbalanced -- no parry against heavy weapons) carry extra
 * game-mechanical meaning this function intentionally does not model;
 * treating them as unparseable (null) keeps this function simple and
 * lets the caller fall back to displaying the raw string as-is.
 */
export function parseParryString(raw: string | null | undefined): ParsedParry | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  return { mod: Number.parseInt(trimmed, 10) };
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
 * Find the best skill on a character's sheet to use for a given
 * weapon's Parry/Block, matching by name. Exact (case-insensitive)
 * name matches win; failing that, a substring match either direction
 * (the weapon name contains the skill name, or vice versa) is used.
 * Skills with a null level (unusable/no default) are skipped. Ties
 * are broken by highest level, then alphabetically by skill name, so
 * the result is deterministic.
 */
export function matchSkillForWeapon(
  weaponName: string,
  skills: readonly SkillCandidate[],
): MatchedSkill | null {
  const weaponLower = weaponName.trim().toLowerCase();
  const usable = skills.filter((s): s is SkillCandidate & { level: number } => s.level !== null);

  const pickBest = (candidates: readonly (SkillCandidate & { level: number })[]) => {
    if (candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return a.name.localeCompare(b.name);
    });
    const best = sorted[0] as SkillCandidate & { level: number };
    return { name: best.name, level: best.level };
  };

  const exact = usable.filter((s) => s.name.trim().toLowerCase() === weaponLower);
  const exactMatch = pickBest(exact);
  if (exactMatch) return exactMatch;

  const substring = usable.filter((s) => {
    const skillLower = s.name.trim().toLowerCase();
    return weaponLower.includes(skillLower) || skillLower.includes(weaponLower);
  });
  return pickBest(substring);
}
