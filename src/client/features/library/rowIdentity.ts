/** Keys are assigned once, within the owning array; existing keys are never rewritten. */
export function unusedRowKey(name: string, existing: readonly string[], maxLength: number): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry';
  const used = new Set(existing.map((key) => key.trim().replace(/\s+/g, ' ').toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${slug.slice(0, maxLength - suffix.length).replace(/-+$/g, '') || 'entry'}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Conservative candidates: compatibility and concurrently edited entries may change. */
export function raceKeyDependencies(
  lenses: readonly Record<string, unknown>[],
  component: 'traits' | 'skills',
  original: string,
  proposed: string,
  additionLenses: readonly Record<string, unknown>[] = lenses,
) {
  const normalize = (key: string) => key.trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = (key: unknown, target: string) =>
    typeof key === 'string' && !!target.trim() && normalize(key) === normalize(target);
  const removal = component === 'traits' ? 'removesTraits' : 'removesSkills';
  const names = (
    rows: readonly Record<string, unknown>[],
    predicate: (lens: Record<string, unknown>) => boolean,
  ) => [...new Set(rows.filter(predicate).map((lens) => String(lens.referenceLabel ?? lens.name)))];
  const removes = (lens: Record<string, unknown>, target: string) =>
    Array.isArray(lens[removal]) &&
    (lens[removal] as unknown[]).some((key) => matches(key, target));
  return {
    oldRemovals: names(lenses, (lens) => removes(lens, original)),
    proposedRemovals: names(lenses, (lens) => removes(lens, proposed)),
    proposedAdditions: names(
      additionLenses,
      (lens) =>
        Array.isArray(lens[component]) &&
        (lens[component] as unknown[]).some(
          (row) =>
            !!row &&
            typeof row === 'object' &&
            matches((row as Record<string, unknown>).key, proposed),
        ),
    ),
  };
}

/** Include every loaded profile: a lens can be unrestricted and compatibility may be edited. */
export function raceProfileDependencies(
  races: readonly Record<string, unknown>[],
  component: 'traits' | 'skills',
  proposed: string,
): string[] {
  const normalized = proposed.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return [];
  const result: string[] = [];
  for (const race of races) {
    const profiles: [unknown, string][] = [[race, String(race.referenceLabel ?? race.name)]];
    for (const kind of ['variants', 'forms']) {
      if (!Array.isArray(race[kind])) continue;
      for (const option of race[kind] as Record<string, unknown>[]) {
        profiles.push([
          option,
          `${String(race.referenceLabel ?? race.name)} — ${String(option.name)}`,
        ]);
      }
    }
    for (const [value, label] of profiles) {
      const profile = value as Record<string, unknown>;
      if (
        Array.isArray(profile[component]) &&
        (profile[component] as Record<string, unknown>[]).some(
          (entry) =>
            typeof entry?.key === 'string' &&
            entry.key.trim().replace(/\s+/g, ' ').toLowerCase() === normalized,
        )
      )
        result.push(label);
    }
  }
  return [...new Set(result)];
}
