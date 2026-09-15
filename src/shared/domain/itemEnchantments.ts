import type {
  ArmorData,
  EnchantmentEffect,
  EnchantmentRef,
  InventoryItemOut,
  WeaponData,
} from '../schemas/inventory.ts';
import type { ResolvedEffect } from './traitEffects.ts';

export interface EnchantmentContribution {
  /** Stable within one item resolution; groups multiple effects from one enchantment instance. */
  instanceKey: string;
  sourceName: string;
  target: EnchantmentEffect['target'];
  value: number;
  active: boolean;
  stackingKey: string | null;
  suppressedByStacking: boolean;
}

export interface ItemEnchantmentResolution {
  armor: ArmorData | null;
  weaponData: WeaponData | null;
  weightReductionPercent: number;
  armorDivisor: number | null;
  effects: ResolvedEffect[];
  breakdown: EnchantmentContribution[];
}

interface ItemInput {
  id: string;
  name: string;
  worn: boolean;
  equipped: boolean;
  isArmor: boolean;
  armor: ArmorData | null;
  weaponData: WeaponData | null;
  weightReductionPercent: number;
  enchantments: readonly EnchantmentRef[];
}

interface Candidate {
  effect: EnchantmentEffect;
  sourceName: string;
  instanceKey: string;
  stackingKey: string | null;
  active: boolean;
}

function applies(item: ItemInput, applicability: string): boolean {
  if (applicability === 'any') return true;
  if (applicability === 'weapon') return item.weaponData != null;
  if (applicability === 'armor') return item.isArmor && item.armor != null;
  return item.weaponData?.db != null;
}

function isActive(item: ItemInput, effect: EnchantmentEffect): boolean {
  if (
    effect.target === 'weapon_attack' ||
    effect.target === 'weapon_damage' ||
    effect.target === 'weapon_accuracy' ||
    effect.target === 'weapon_parry' ||
    effect.target === 'weapon_block' ||
    effect.target === 'armor_divisor'
  )
    return item.weaponData != null && item.equipped;
  if (effect.target === 'dr') return item.isArmor && item.armor != null && item.equipped;
  if (effect.target === 'db')
    return item.equipped && ((item.isArmor && item.armor != null) || item.weaponData?.db != null);
  if (effect.target === 'weight_reduction_percent') return item.worn;
  return item.equipped || item.worn;
}

function candidates(item: ItemInput): Candidate[] {
  const out: Candidate[] = [];
  for (const [index, instance] of item.enchantments.entries()) {
    const mechanics = instance.mechanics;
    if (!mechanics || !applies(item, mechanics.applicability)) continue;
    const sourceName = `${item.name}: ${instance.spellName}`;
    const instanceKey = `${instance.definitionId ?? instance.spellName}:${index}`;
    const stackingKey =
      mechanics.stackingPolicy.kind === 'highest' ? mechanics.stackingPolicy.key : null;
    for (const effect of mechanics.effects)
      out.push({ effect, sourceName, instanceKey, active: isActive(item, effect), stackingKey });
    const selected = mechanics.levels.find((entry) => entry.level === instance.level);
    for (const effect of selected?.effects ?? [])
      out.push({ effect, sourceName, instanceKey, active: isActive(item, effect), stackingKey });
  }
  return out;
}

function candidateKey(candidate: Candidate): string | null {
  if (!candidate.stackingKey) return null;
  return `${candidate.stackingKey}|${candidate.effect.target}|${candidate.effect.skillName ?? ''}`;
}

/** Resolve typed item-local declarations once. Base item columns are never
 * rewritten, so legacy manual values remain the single base layer. */
export function resolveItemEnchantments(item: ItemInput): ItemEnchantmentResolution {
  const all = candidates(item);
  const totals = new Map<string, Map<string, number>>();
  for (const candidate of all) {
    const key = candidateKey(candidate);
    if (!key) continue;
    const byInstance = totals.get(key) ?? new Map<string, number>();
    byInstance.set(
      candidate.instanceKey,
      (byInstance.get(candidate.instanceKey) ?? 0) + candidate.effect.value,
    );
    totals.set(key, byInstance);
  }
  const winners = new Map<string, string>();
  for (const [key, byInstance] of totals) {
    let winner: string | null = null;
    let value = Number.NEGATIVE_INFINITY;
    for (const [instanceKey, total] of byInstance) {
      if (total > value) {
        winner = instanceKey;
        value = total;
      }
    }
    if (winner) winners.set(key, winner);
  }
  const applied = all.filter((candidate) => {
    const key = candidateKey(candidate);
    return !key || winners.get(key) === candidate.instanceKey;
  });
  const active = applied.filter((candidate) => candidate.active);
  const sum = (target: EnchantmentEffect['target']) =>
    active
      .filter((candidate) => candidate.effect.target === target)
      .reduce((total, candidate) => total + candidate.effect.value, 0);
  const armor = item.armor
    ? {
        ...item.armor,
        dr: Math.max(0, item.armor.dr + sum('dr')),
        ...(item.armor.drCrushing == null
          ? {}
          : { drCrushing: Math.max(0, item.armor.drCrushing + sum('dr')) }),
        typedDr: Object.fromEntries(
          Object.entries(item.armor.typedDr ?? {}).map(([key, value]) => [
            key,
            value == null ? value : Math.max(0, value + sum('dr')),
          ]),
        ),
        ...(item.armor.db == null
          ? sum('db') === 0
            ? {}
            : { db: Math.max(0, sum('db')) }
          : { db: Math.max(0, item.armor.db + sum('db')) }),
      }
    : null;
  const weaponData = item.weaponData
    ? {
        ...item.weaponData,
        // Presence of base DB is the shield marker. Never turn an ordinary
        // weapon into a shield merely because it carries a DB declaration.
        ...(item.weaponData.db == null ? {} : { db: Math.max(0, item.weaponData.db + sum('db')) }),
      }
    : null;
  const effects: ResolvedEffect[] = active.flatMap((candidate) => {
    const target = candidate.effect.target;
    if (
      target !== 'weapon_attack' &&
      target !== 'weapon_damage' &&
      target !== 'weapon_accuracy' &&
      target !== 'weapon_parry' &&
      target !== 'weapon_block' &&
      target !== 'skill'
    )
      return [];
    return [
      {
        sourceKind: 'item',
        sourceName: candidate.sourceName,
        sourceId: item.id,
        target,
        value: candidate.effect.value,
        ...(target === 'skill'
          ? { skillName: candidate.effect.skillName as string }
          : { weaponSelector: { kind: 'inventory_item' as const, inventoryItemId: item.id } }),
        active: true,
      },
    ];
  });
  const divisors = active
    .filter((candidate) => candidate.effect.target === 'armor_divisor')
    .map((candidate) => candidate.effect.value)
    .filter((value) => value > 0);
  return {
    armor,
    weaponData,
    weightReductionPercent: Math.min(
      100,
      Math.max(0, item.weightReductionPercent + sum('weight_reduction_percent')),
    ),
    armorDivisor: divisors.length ? Math.max(...divisors) : null,
    effects,
    breakdown: all.map((candidate) => {
      const key = candidateKey(candidate);
      return {
        instanceKey: candidate.instanceKey,
        sourceName: candidate.sourceName,
        target: candidate.effect.target,
        value: candidate.effect.value,
        active: candidate.active,
        stackingKey: candidate.stackingKey,
        suppressedByStacking: key !== null && winners.get(key) !== candidate.instanceKey,
      };
    }),
  };
}

export function enchantmentResolutionForOutput(
  item: ItemInput,
): Pick<
  InventoryItemOut,
  | 'armor'
  | 'weaponData'
  | 'baseArmor'
  | 'baseWeaponData'
  | 'effectiveArmorDivisor'
  | 'effectiveWeightReductionPercent'
  | 'enchantmentBreakdown'
> & { effects: ResolvedEffect[] } {
  const resolved = resolveItemEnchantments(item);
  return {
    armor: resolved.armor,
    weaponData: resolved.weaponData,
    baseArmor: item.armor,
    baseWeaponData: item.weaponData,
    effectiveArmorDivisor: resolved.armorDivisor,
    effectiveWeightReductionPercent: resolved.weightReductionPercent,
    enchantmentBreakdown: resolved.breakdown,
    effects: resolved.effects,
  };
}
