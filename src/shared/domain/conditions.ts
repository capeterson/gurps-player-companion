/**
 * Combat-tracker condition normalization.
 *
 * `shared/constants/combat.ts` defines `COMMON_CONDITIONS` as canonical
 * snake_case ids (`'stunned'`, `'on_fire'`, ...), but the persisted
 * `conditions: string[]` array on a character's combat state accepts
 * arbitrary strings, and an earlier version of the CombatModal UI wrote
 * Capitalized display strings ('Stunned', 'Shock') into that array
 * instead. This module lets both old and new data compare equal
 * without a destructive data migration: everything is compared and
 * toggled through its normalized snake_case form, while legacy entries
 * are only rewritten when the user actually toggles them.
 */

/** Lowercase + trim + spaces-to-underscores, e.g. "On Fire" -> "on_fire". */
export function normalizeCondition(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/** snake_case -> Title Case with spaces, e.g. "on_fire" -> "On Fire". */
export function conditionLabel(id: string): string {
  return normalizeCondition(id)
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

/** True if any entry in `list` normalizes to the same id as `id`. */
export function conditionsInclude(list: readonly string[], id: string): boolean {
  const target = normalizeCondition(id);
  return list.some((entry) => normalizeCondition(entry) === target);
}

/**
 * Toggle a condition on a persisted list. If present (by normalized
 * match), every entry that normalizes to it is removed -- this cleans
 * up legacy duplicates like ['Stunned', 'stunned'] in one gesture.
 * Otherwise the canonical snake_case id is appended.
 */
export function toggleCondition(list: readonly string[], id: string): string[] {
  const target = normalizeCondition(id);
  if (conditionsInclude(list, target)) {
    return list.filter((entry) => normalizeCondition(entry) !== target);
  }
  return [...list, target];
}
