/**
 * Aggregate equipped armor DR per hit location.
 *
 * Iterates over a character's inventory, filtering to equipped armor
 * items (`equipped && isArmor && armor != null`). For each location the
 * item covers, sums the `dr` (and tracks typed DR overrides where
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

import type { ArmorData, TypedArmorDr } from '../schemas/inventory.ts';

export interface ArmorItemRow {
  readonly equipped: boolean;
  readonly isArmor: boolean;
  readonly armor: ArmorData | null;
}

/**
 * Per-type DR totals for a single location. Each key mirrors a
 * `typedArmorDr` field — when a non-null value is present it is the
 * summed DR from all equipped armor pieces that override that type at
 * this location. `null` means no armor at this location provides a
 * type-specific override (the resolver falls through to `dr`).
 */
export interface TypedDrTotals {
  readonly cut: number | null;
  readonly imp: number | null;
  readonly pi: number | null;
  readonly pi_minus: number | null;
  readonly pi_plus: number | null;
  readonly pi_pp: number | null;
  readonly burn: number | null;
  readonly corr: number | null;
  readonly fat: number | null;
  readonly tox: number | null;
}

const EMPTY_TYPED_DR: TypedDrTotals = {
  cut: null,
  imp: null,
  pi: null,
  pi_minus: null,
  pi_plus: null,
  pi_pp: null,
  burn: null,
  corr: null,
  fat: null,
  tox: null,
};

export interface DrByLocation {
  /** Total DR for this location across all equipped armor. */
  readonly dr: number;
  /** Total crushing-specific DR, or null when no item overrides it for this location. */
  readonly drCrushing: number | null;
  /** Per-type DR totals (cut/imp/pi/burn/corr/fat/tox). */
  readonly typedDr: TypedDrTotals;
}

/** Map of hit-location string → aggregated DR. */
export type DrByLocationMap = Map<string, DrByLocation>;

function mergeTypedDr(
  prev: TypedDrTotals | undefined,
  armor: TypedArmorDr | undefined,
): TypedDrTotals {
  const result: Record<string, number | null> = {};
  for (const key of Object.keys(EMPTY_TYPED_DR) as (keyof TypedDrTotals)[]) {
    const newVal = armor?.[key];
    const prevVal = prev?.[key];
    if (newVal != null) {
      result[key] = (prevVal ?? 0) + newVal;
    } else {
      result[key] = prevVal ?? null;
    }
  }
  return result as unknown as TypedDrTotals;
}

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
      const typedDr = mergeTypedDr(prev?.typedDr, armor.typedDr ?? undefined);
      map.set(loc, { dr, drCrushing, typedDr });
    }
  }
  return map;
}

/**
 * Sum armor Defense Bonus from all equipped armor pieces (B287).
 * Unlike shields (which use pickShield to select one), multiple armor
 * pieces can each contribute DB from Deflect enchantments.
 */
export function sumArmorDb(items: readonly ArmorItemRow[]): number {
  let total = 0;
  for (const item of items) {
    if (!item.equipped || !item.isArmor || item.armor == null) continue;
    const db = item.armor.db;
    if (db != null) total += db;
  }
  return total;
}

/** Canonical GURPS damage type keys for typed DR lookup. */
export type DamageTypeKey = keyof TypedDrTotals;

/** Map damage type strings used in the UI/dialog to the TypedDrTotals key. */
const TYPE_MAP: Record<string, DamageTypeKey> = {
  cut: 'cut',
  imp: 'imp',
  pi: 'pi',
  'pi-': 'pi_minus',
  pi_minus: 'pi_minus',
  'pi+': 'pi_plus',
  pi_plus: 'pi_plus',
  'pi++': 'pi_pp',
  pi_pp: 'pi_pp',
  burn: 'burn',
  cor: 'corr',
  tox: 'tox',
  fat: 'fat',
};

/**
 * Resolve DR against an incoming damage type for a location.
 *
 * Fallback order (GURPS B378):
 *   1. `typedDr[damageType]` — per-type override from the armor.
 *   2. `drCrushing` — legacy crushing override (only for `cr`).
 *   3. `dr` — the base/default DR.
 */
export function resolveDr(
  type: string | null | undefined,
  entry: DrByLocation | undefined,
): number {
  if (entry == null) return 0;
  const normalized = type?.trim().toLowerCase() ?? '';
  const key = TYPE_MAP[normalized];

  if (key != null) {
    const typedValue = entry.typedDr[key];
    if (typedValue != null) return typedValue;
  }

  // Legacy crushing override for 'cr' type
  if (normalized === 'cr' && entry.drCrushing != null) {
    return entry.drCrushing;
  }

  return entry.dr;
}
