/**
 * Aggregate equipped armor DR per hit location.
 *
 * Iterates over a character's inventory, filtering to equipped armor
 * items (`equipped && isArmor && armor != null`). For each location the
 * item covers, sums the `dr` into the base total and adds each layer's
 * contribution to the per-type totals — a layer with a type override
 * contributes the override, otherwise its base `dr`, so a base-DR 4
 * jacket plus a DR 2 coif with a `cut: 5` override gives cut DR 9, not
 * 5 (the override replaces the affected layer's contribution, never the
 * whole stack). Returns a Map keyed by location string — well-known
 * locations are from `HIT_LOCATIONS`, but custom homebrew location
 * strings pass through unchanged. Torso armor also covers the vitals;
 * repeated locations count once per piece, including explicit vitals coverage.
 *
 * `frontOnly` / `backOnly` items are included as-is; the combat tab
 * doesn't model facing, so both front and back coverage contribute to
 * the displayed DR. A future facing model would split these.
 *
 * Pure TS (shared domain) — runs in Bun, browser, and service worker.
 */

import { HIT_LOCATIONS } from '../constants/hitLocations.ts';
import type { ResolvedEffectOut } from '../schemas/character.ts';
import type { ArmorData } from '../schemas/inventory.ts';

export interface ArmorItemRow {
  readonly equipped: boolean;
  readonly isArmor: boolean;
  readonly armor: ArmorData | null;
}

/**
 * Per-type DR totals for a single location. Each key mirrors a
 * `typedArmorDr` field. A location's per-type value is the sum, across
 * every equipped piece covering that location, of that piece's
 * type-specific override when present and otherwise its base `dr` — so
 * a base-DR 4 jacket plus a DR 2 coif with `cut: 5` gives 9 vs cut,
 * not 5 (type overrides replace the affected piece's contribution, they
 * do not replace the whole stack).
 */
export interface TypedDrTotals {
  readonly cut: number;
  readonly imp: number;
  readonly pi: number;
  readonly pi_minus: number;
  readonly pi_plus: number;
  readonly pi_pp: number;
  readonly burn: number;
  readonly corr: number;
  readonly fat: number;
  readonly tox: number;
}

const EMPTY_TYPED_DR: TypedDrTotals = {
  cut: 0,
  imp: 0,
  pi: 0,
  pi_minus: 0,
  pi_plus: 0,
  pi_pp: 0,
  burn: 0,
  corr: 0,
  fat: 0,
  tox: 0,
};

export interface DrByLocation {
  /** Innate and skull contribution retained separately for campaign penetration rules. */
  readonly naturalDr?: { readonly dr: number; readonly tox: number };
  /** Total DR for this location across all equipped armor. */
  readonly dr: number;
  /** Total crushing-specific DR, or null when no item overrides it for this location. */
  readonly drCrushing: number | null;
  /** Per-type DR totals (cut/imp/pi/burn/corr/fat/tox). */
  readonly typedDr: TypedDrTotals;
}

/** Map of hit-location string → aggregated DR. */
export type DrByLocationMap = Map<string, DrByLocation>;

/** Torso armor protects the vitals within it; a vitals-only plate stays scoped. */
export function armorCoversLocation(armor: ArmorData, location: string): boolean {
  return (
    armor.locations.includes(location) ||
    (location === 'vitals' && armor.locations.includes('torso'))
  );
}

function mergeTypedDr(
  prev: TypedDrTotals | undefined,
  armor: ArmorData | undefined,
): TypedDrTotals {
  const result: Record<string, number> = {};
  // A layer with no override for a given type still contributes its
  // base `dr`; an override replaces that layer's contribution only.
  const contribution: Record<string, number> = {};
  for (const key of Object.keys(EMPTY_TYPED_DR) as (keyof TypedDrTotals)[]) {
    const override = armor?.typedDr?.[key];
    contribution[key] = override ?? armor?.dr ?? 0;
  }
  for (const key of Object.keys(EMPTY_TYPED_DR) as (keyof TypedDrTotals)[]) {
    result[key] = (prev?.[key] ?? 0) + (contribution[key] ?? 0);
  }
  return result as unknown as TypedDrTotals;
}

export function aggregateDrByLocation(items: readonly ArmorItemRow[]): DrByLocationMap {
  const map: DrByLocationMap = new Map();
  for (const item of items) {
    if (!item.equipped || !item.isArmor || item.armor == null) continue;
    const armor = item.armor;
    const locations = new Set(armor.locations);
    if (locations.has('torso')) locations.add('vitals');
    for (const loc of locations) {
      const prev = map.get(loc);
      const dr = (prev?.dr ?? 0) + armor.dr;
      const drCrushing =
        armor.drCrushing != null || prev?.drCrushing != null
          ? (prev?.drCrushing ?? prev?.dr ?? 0) + (armor.drCrushing ?? armor.dr)
          : null;
      const typedDr = mergeTypedDr(prev?.typedDr, armor);
      map.set(loc, { dr, drCrushing, typedDr });
    }
  }
  return map;
}

/** Partial torso DR includes the vital organs (B47), just as torso armor does. */
export function innateDrCoversLocation(hitLocation: string | undefined, location: string): boolean {
  return hitLocation
    ? hitLocation === location || (hitLocation === 'torso' && location === 'vitals')
    : location !== 'eye';
}

/** The skull's extra DR and injury effects do not apply to toxic damage (B399). */
export function naturalSkullDr(type: string | null | undefined): number {
  return type?.trim().toLowerCase() === 'tox' ? 0 : 2;
}

/** Complete protection for the readout and damage resolver (B46/B400).
 * Unscoped innate DR excludes eyes; an explicit eye declaration can cover them.
 * Location declarations retain their exact schema keys, including custom locations.
 * Natural skull DR is included here, before any incoming armor divisor.
 */
export function effectiveDrByLocation(
  items: readonly ArmorItemRow[],
  effects: readonly Pick<ResolvedEffectOut, 'target' | 'active' | 'value' | 'hitLocation'>[] = [],
): DrByLocationMap {
  const map = aggregateDrByLocation(items);
  const drEffects = effects.filter((effect) => effect.active && effect.target === 'dr');
  const locations = new Set<string>([
    ...HIT_LOCATIONS,
    ...map.keys(),
    ...drEffects.flatMap((effect) => (effect.hitLocation ? [effect.hitLocation] : [])),
  ]);
  for (const location of locations) {
    const innate = drEffects.reduce(
      (sum, effect) =>
        sum + (innateDrCoversLocation(effect.hitLocation, location) ? effect.value : 0),
      0,
    );
    const extra = innate + (location === 'skull' ? 2 : 0);
    const armor = map.get(location);
    if (!armor && extra === 0) continue;
    const typedDr = { ...EMPTY_TYPED_DR };
    for (const key of Object.keys(typedDr) as (keyof TypedDrTotals)[]) {
      const natural = location === 'skull' ? naturalSkullDr(key) : 0;
      typedDr[key] = Math.max(0, (armor?.typedDr[key] ?? 0) + innate + natural);
    }
    map.set(location, {
      naturalDr: { dr: Math.max(0, extra), tox: Math.max(0, innate) },
      dr: Math.max(0, (armor?.dr ?? 0) + extra),
      drCrushing: armor?.drCrushing == null ? null : Math.max(0, armor.drCrushing + extra),
      typedDr,
    });
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
  burn_tight: 'burn',
  cor: 'corr',
  corr: 'corr',
  tox: 'tox',
  fat: 'fat',
};

/**
 * Resolve DR against an incoming damage type for a location.
 *
 * Fallback order (GURPS B378):
 *   1. `typedDr[damageType]` — per-type total (always populated; each
 *      layer contributes its override or its base `dr`).
 *   2. `drCrushing` — legacy crushing override (only for `cr`, which
 *      has no typedDr key).
 *   3. `dr` — the base/default DR (for unknown / untyped damage).
 */
export function resolveDr(
  type: string | null | undefined,
  entry: DrByLocation | undefined,
): number {
  if (entry == null) return 0;
  const normalized = type?.trim().toLowerCase() ?? '';
  const key = TYPE_MAP[normalized];

  if (key != null) {
    return entry.typedDr[key];
  }

  // Legacy crushing override for 'cr' type
  if (normalized === 'cr' && entry.drCrushing != null) {
    return entry.drCrushing;
  }

  return entry.dr;
}
