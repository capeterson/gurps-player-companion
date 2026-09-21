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
 * When a facing is supplied, directional armor is filtered before it
 * contributes. Front-only and back-only pieces do not protect either side;
 * non-directional armor protects every facing.
 *
 * Pure TS (shared domain) — runs in Bun, browser, and service worker.
 */

import { HIT_LOCATIONS } from '../constants/hitLocations.ts';
import type { ResolvedEffectOut } from '../schemas/character.ts';
import type { ArmorData, InventoryItemOut } from '../schemas/inventory.ts';

export interface ArmorItemRow {
  readonly id?: string;
  readonly name?: string;
  readonly equipped: boolean;
  readonly isArmor: boolean;
  readonly armor: ArmorData | null;
  /** Present on resolved character-detail rows; absent on raw legacy callers. */
  readonly baseArmor?: ArmorData | null | undefined;
  readonly enchantmentBreakdown?: InventoryItemOut['enchantmentBreakdown'] | undefined;
}

export type ArmorFacing = 'front' | 'back' | 'left' | 'right';

/** Whether one directional armor layer protects the selected incoming facing. */
export function armorAppliesToFacing(armor: ArmorData, facing?: ArmorFacing): boolean {
  if (!facing) return true;
  if (facing === 'front') return !armor.backOnly;
  if (facing === 'back') return !armor.frontOnly;
  return !armor.frontOnly && !armor.backOnly;
}

export interface LayeredArmorDrContribution {
  readonly itemKey: string;
  readonly sourceName: string;
  readonly value: number;
  readonly stackingKey: string | null;
  readonly status: 'applied' | 'winning' | 'suppressed' | 'inactive';
  readonly winnerName?: string;
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

function armorItemKey(item: ArmorItemRow, index: number): string {
  return item.id ?? `${item.name ?? 'armor'}:${index}`;
}

function canDecomposeArmor(item: ArmorItemRow): boolean {
  return item.baseArmor !== undefined && item.enchantmentBreakdown !== undefined;
}

function armorForAggregation(item: ArmorItemRow): ArmorData | null {
  return canDecomposeArmor(item) ? (item.baseArmor ?? null) : item.armor;
}

/**
 * Resolve highest-only armor DR enchantments across every equipped layer that
 * covers one location. A Fortify on boots must not suppress a Fortify on a
 * coif, while two Fortifies covering the skull compete as one stack.
 */
export function layeredArmorDrContributions(
  items: readonly ArmorItemRow[],
  location: string,
  facing?: ArmorFacing,
): LayeredArmorDrContribution[] {
  const grouped = new Map<
    string,
    {
      itemKey: string;
      sourceName: string;
      value: number;
      stackingKey: string | null;
      active: boolean;
      decomposable: boolean;
      suppressedByItemStacking: boolean;
    }
  >();
  for (const [index, item] of items.entries()) {
    if (!item.equipped || !item.isArmor) continue;
    const coverage = armorForAggregation(item);
    if (
      !coverage ||
      !armorCoversLocation(coverage, location) ||
      !armorAppliesToFacing(coverage, facing)
    )
      continue;
    const itemKey = armorItemKey(item, index);
    for (const contribution of item.enchantmentBreakdown ?? []) {
      if (contribution.target !== 'dr') continue;
      const key = [
        itemKey,
        contribution.instanceKey ??
          `legacy:${contribution.sourceName}:${contribution.suppressedByStacking ? 'suppressed' : 'eligible'}`,
        contribution.stackingKey ?? '',
        contribution.active ? 'active' : 'inactive',
      ].join('|');
      const previous = grouped.get(key);
      grouped.set(key, {
        itemKey,
        sourceName: contribution.sourceName,
        value: (previous?.value ?? 0) + contribution.value,
        stackingKey: contribution.stackingKey,
        active: contribution.active,
        decomposable: canDecomposeArmor(item),
        suppressedByItemStacking:
          (previous?.suppressedByItemStacking ?? false) || contribution.suppressedByStacking,
      });
    }
  }
  const lines = [...grouped.values()];
  const byStack = new Map<string, typeof lines>();
  for (const line of lines) {
    if (!line.active || !line.decomposable || line.suppressedByItemStacking || !line.stackingKey)
      continue;
    const entries = byStack.get(line.stackingKey) ?? [];
    entries.push(line);
    byStack.set(line.stackingKey, entries);
  }
  const winnerByStack = new Map<string, (typeof lines)[number]>();
  for (const [stackingKey, entries] of byStack) {
    entries.sort(
      (left, right) =>
        right.value - left.value ||
        left.sourceName.localeCompare(right.sourceName) ||
        left.itemKey.localeCompare(right.itemKey),
    );
    const winner = entries[0];
    if (winner) winnerByStack.set(stackingKey, winner);
  }
  return lines.map((entry) => {
    const { active, decomposable, suppressedByItemStacking, ...line } = entry;
    if (!active) return { ...line, status: 'inactive' };
    // Without both the persisted base snapshot and a breakdown, the item's
    // effective armor is indivisible. Keep its annotation informational rather
    // than claiming another layer suppressed a bonus that remains in the total.
    if (!decomposable) {
      if (!suppressedByItemStacking) return { ...line, status: 'applied' };
      const localWinner = lines
        .filter(
          (candidate) =>
            candidate.itemKey === line.itemKey &&
            candidate.active &&
            !candidate.suppressedByItemStacking &&
            candidate.stackingKey === line.stackingKey,
        )
        .sort(
          (left, right) =>
            right.value - left.value || left.sourceName.localeCompare(right.sourceName),
        )[0];
      return {
        ...line,
        status: 'suppressed',
        ...(localWinner ? { winnerName: localWinner.sourceName } : {}),
      };
    }
    const winner = line.stackingKey ? winnerByStack.get(line.stackingKey) : undefined;
    if (suppressedByItemStacking)
      return {
        ...line,
        status: 'suppressed',
        ...(winner ? { winnerName: winner.sourceName } : {}),
      };
    if (!line.stackingKey || !winnerByStack.has(line.stackingKey))
      return { ...line, status: 'applied' };
    if (winner === undefined || winner === entry)
      return {
        ...line,
        status:
          lines.filter(
            (candidate) =>
              candidate.active &&
              candidate.decomposable &&
              candidate.stackingKey === line.stackingKey,
          ).length > 1
            ? 'winning'
            : 'applied',
      };
    return {
      ...line,
      status: 'suppressed',
      winnerName: winner.sourceName,
    };
  });
}

export function aggregateDrByLocation(
  items: readonly ArmorItemRow[],
  facing?: ArmorFacing,
): DrByLocationMap {
  const map: DrByLocationMap = new Map();
  const locations = new Set<string>();
  for (const item of items) {
    if (!item.equipped || !item.isArmor) continue;
    const armor = armorForAggregation(item);
    if (!armor || !armorAppliesToFacing(armor, facing)) continue;
    for (const location of armor.locations) locations.add(location);
    if (armor.locations.includes('torso')) locations.add('vitals');
  }
  for (const location of locations) {
    const appliedByItem = new Map<string, number>();
    for (const line of layeredArmorDrContributions(items, location, facing)) {
      if (line.status !== 'applied' && line.status !== 'winning') continue;
      appliedByItem.set(line.itemKey, (appliedByItem.get(line.itemKey) ?? 0) + line.value);
    }
    for (const [index, item] of items.entries()) {
      if (!item.equipped || !item.isArmor) continue;
      const hasDecomposition = canDecomposeArmor(item);
      const armor = armorForAggregation(item);
      if (!armor || !armorCoversLocation(armor, location) || !armorAppliesToFacing(armor, facing))
        continue;
      const modifier = hasDecomposition ? (appliedByItem.get(armorItemKey(item, index)) ?? 0) : 0;
      const layerDr = Math.max(0, armor.dr + modifier);
      const previous = map.get(location);
      const dr = (previous?.dr ?? 0) + layerDr;
      const layerCrushing =
        armor.drCrushing == null ? null : Math.max(0, armor.drCrushing + modifier);
      const drCrushing =
        layerCrushing != null || previous?.drCrushing != null
          ? (previous?.drCrushing ?? previous?.dr ?? 0) + (layerCrushing ?? layerDr)
          : null;
      const effectiveArmor = {
        ...armor,
        dr: layerDr,
        typedDr: Object.fromEntries(
          Object.entries(armor.typedDr ?? {}).map(([key, value]) => [
            key,
            value == null ? value : Math.max(0, value + modifier),
          ]),
        ),
      };
      const typedDr = mergeTypedDr(previous?.typedDr, effectiveArmor);
      map.set(location, { dr, drCrushing, typedDr });
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
  facing?: ArmorFacing,
): DrByLocationMap {
  const map = aggregateDrByLocation(items, facing);
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

export interface ArmorDbResolution {
  readonly db: number;
  readonly itemId: string;
  readonly itemName: string;
}

/**
 * Resolve the one armor Defense Bonus that applies to an incoming hit.
 * Armor DB does not stack: filter by equipment, location, and known facing,
 * then choose the maximum. Empty `locations` means no coverage, matching
 * `aggregateDrByLocation`. Equal values use stable id/name ordering so the
 * displayed source never flickers or gets counted twice.
 */
export function resolveArmorDb(
  items: readonly ArmorItemRow[],
  hitLocation: string,
  facing?: ArmorFacing,
): ArmorDbResolution | null {
  const candidates = items.flatMap((item, index) => {
    const armor = item.armor;
    if (
      !item.equipped ||
      !item.isArmor ||
      armor == null ||
      !armorCoversLocation(armor, hitLocation)
    )
      return [];
    if (!armorAppliesToFacing(armor, facing)) return [];
    const db = armor.db ?? 0;
    if (db <= 0) return [];
    return [
      {
        db,
        itemId: item.id ?? `armor-${index}`,
        itemName: item.name ?? 'Armor',
      },
    ];
  });
  candidates.sort(
    (a, b) =>
      b.db - a.db || a.itemId.localeCompare(b.itemId) || a.itemName.localeCompare(b.itemName),
  );
  return candidates[0] ?? null;
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
