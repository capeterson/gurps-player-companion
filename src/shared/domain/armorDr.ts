/**
 * Aggregate equipped armor DR per hit location.
 *
 * Iterates over a character's inventory, filtering to equipped armor
 * items (`equipped && isArmor && armor != null`). For each location the
 * item covers, sums the `dr` (and tracks `drCrushing` overrides where
 * present). Returns a Map keyed by location string — well-known
 * locations are from `HIT_LOCATIONS`, but custom homebrew location
 * strings pass through unchanged.
 *
 * `frontOnly` / `backOnly` items are included as-is; the combat tab
 * doesn't model facing, so both front and back coverage contribute to
 * the displayed DR. A future facing model would split these.
 *
 * Pure TS (shared domain) — runs in Bun, browser, and service worker.
 */

import type { ArmorData } from '../schemas/inventory.ts';

export interface ArmorItemRow {
  readonly equipped: boolean;
  readonly isArmor: boolean;
  readonly armor: ArmorData | null;
}

export interface DrByLocation {
  /** Total DR for this location across all equipped armor. */
  readonly dr: number;
  /** Total crushing-specific DR, or null when no item overrides it for this location. */
  readonly drCrushing: number | null;
}

/** Map of hit-location string → aggregated DR. */
export type DrByLocationMap = Map<string, DrByLocation>;

export function aggregateDrByLocation(items: readonly ArmorItemRow[]): DrByLocationMap {
  const map: DrByLocationMap = new Map();
  for (const item of items) {
    if (!item.equipped || !item.isArmor || item.armor == null) continue;
    const armor = item.armor;
    for (const loc of armor.locations) {
      const prev = map.get(loc);
      const dr = (prev?.dr ?? 0) + armor.dr;
      const drCrushing =
        armor.drCrushing != null
          ? (prev?.drCrushing ?? 0) + armor.drCrushing
          : (prev?.drCrushing ?? null);
      map.set(loc, { dr, drCrushing });
    }
  }
  return map;
}
