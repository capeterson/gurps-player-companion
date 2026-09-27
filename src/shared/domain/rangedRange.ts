import type { RangedRange } from '../schemas/inventory.ts';

export interface ResolvedRangedRange {
  halfDamageYards: number | null;
  maxYards: number;
  minimumYards: number | null;
}

/** Resolve already-structured weapon data. Legacy notation is never interpreted
 * on a roll path; the owner must repair it in the item editor. */
export function resolveRangedRange(
  range: RangedRange | null | undefined,
  wielderSt: number,
  weaponSt: number | null | undefined,
): ResolvedRangedRange | null {
  if (!range || range.kind === 'legacy') return null;
  if (range.kind === 'fixed')
    return {
      halfDamageYards: range.halfDamageYards,
      maxYards: range.maxYards,
      minimumYards: range.minimumYards ?? null,
    };
  const strength = range.strengthSource === 'weapon' ? weaponSt : wielderSt;
  if (strength == null || !Number.isFinite(strength) || strength <= 0) return null;
  return {
    halfDamageYards: range.halfDamageFactor == null ? null : range.halfDamageFactor * strength,
    maxYards: range.maxFactor * strength,
    minimumYards: range.minimumYards ?? null,
  };
}

export function formatRangedRange(range: RangedRange | null | undefined): string | null {
  if (!range) return null;
  if (range.kind === 'legacy') return `Range needs review (${range.notation})`;
  if (range.kind === 'fixed')
    return `${range.halfDamageYards == null ? '' : `${range.halfDamageYards}/`}${range.maxYards}`;
  return `${range.halfDamageFactor == null ? '' : `×${range.halfDamageFactor}/`}×${range.maxFactor} ST`;
}

export interface RangeBand {
  maxYards: number;
  penalty: number;
}

/** B550's 3/5/7/10/15/20 progression repeats every factor of ten. */
export function rangePenaltyForYards(yards: number): number {
  if (yards <= 2) return 0;
  let scale = 1;
  let penalty = 0;
  while (scale <= yards) {
    for (const step of [3, 5, 7, 10, 15, 20]) {
      penalty -= 1;
      if (yards <= step * scale) return penalty;
    }
    scale *= 10;
  }
  return penalty;
}

/** Equal-width slider stops per rule band; the weapon's exact Max is the last
 * stop even when it falls between printed table boundaries. */
export function rangeBandsThrough(maxYards: number): RangeBand[] {
  if (!Number.isFinite(maxYards) || maxYards <= 0) return [];
  const bands: RangeBand[] = [{ maxYards: Math.min(2, maxYards), penalty: 0 }];
  let scale = 1;
  let penalty = 0;
  while ((bands.at(-1)?.maxYards ?? 0) < maxYards) {
    for (const step of [3, 5, 7, 10, 15, 20]) {
      penalty -= 1;
      const boundary = step * scale;
      if (boundary >= maxYards) {
        bands.push({ maxYards, penalty });
        return bands;
      }
      bands.push({ maxYards: boundary, penalty });
    }
    scale *= 10;
  }
  return bands;
}

/** Only for one-time import of old YAML. API writes require the structured
 * schema, and roll/display paths never parse legacy strings. */
export function upgradeLegacyRange(
  notation: string,
  strengthSource: 'wielder' | 'weapon' = 'wielder',
): RangedRange | null {
  const raw = notation.trim();
  if (raw === '') return null;
  const fixed = /^(?:(\d+)\/)?(\d+)$/.exec(raw);
  if (fixed) {
    const halfDamageYards = fixed[1] ? Number(fixed[1]) : null;
    const maxYards = Number(fixed[2]);
    if (
      maxYards > 0 &&
      maxYards <= 1_000_000_000 &&
      (halfDamageYards == null ||
        (halfDamageYards > 0 && halfDamageYards <= 1_000_000_000 && halfDamageYards <= maxYards))
    )
      return { kind: 'fixed', halfDamageYards, maxYards };
  }
  const multiple = /^(?:[x×](\d+)\/)?[x×](\d+)$/i.exec(raw);
  if (multiple) {
    const halfDamageFactor = multiple[1] ? Number(multiple[1]) : null;
    const maxFactor = Number(multiple[2]);
    if (
      maxFactor > 0 &&
      maxFactor <= 1_000_000 &&
      (halfDamageFactor == null ||
        (halfDamageFactor > 0 && halfDamageFactor <= 1_000_000 && halfDamageFactor <= maxFactor))
    )
      return { kind: 'st_multiplier', halfDamageFactor, maxFactor, strengthSource };
  }
  return { kind: 'legacy', notation: raw || notation };
}

/** One-time upgrade for imported YAML and old IndexedDB rows/outbox bodies. */
export function upgradeLegacyWeaponRanges<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const data = structuredClone(value) as Record<string, unknown>;
  const skill = typeof data.skill === 'string' ? data.skill : '';
  function upgradeRanged(block: unknown, governingSkill: string): unknown {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const next = block as Record<string, unknown>;
    if (typeof next.range === 'string') {
      const source = /^(bow|crossbow)(\W|$)/i.test(governingSkill) ? 'weapon' : 'wielder';
      next.range = upgradeLegacyRange(next.range, source);
    }
    return next;
  }
  data.ranged = upgradeRanged(data.ranged, skill);
  for (const key of ['modes', 'alternateModes']) {
    if (!Array.isArray(data[key])) continue;
    data[key] = (data[key] as unknown[]).map((mode) => {
      if (!mode || typeof mode !== 'object' || Array.isArray(mode)) return mode;
      const next = mode as Record<string, unknown>;
      next.ranged = upgradeRanged(next.ranged, typeof next.skill === 'string' ? next.skill : skill);
      return next;
    });
  }
  return data as T;
}
