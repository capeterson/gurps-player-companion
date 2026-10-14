import { formatSigned } from '../../../../../shared/format/number.ts';
import type { LibraryEnchantmentOut } from '../../../../../shared/schemas/campaignLibrary.ts';
import type {
  EnchantmentApplicability,
  EnchantmentEffect,
  EnchantmentEffectTarget,
  EnchantmentMechanics,
  EnchantmentRef,
} from '../../../../../shared/schemas/inventory.ts';

export const ENCHANTMENT_EFFECT_LABELS: Record<EnchantmentEffectTarget, string> = {
  weapon_attack: 'Attack roll bonus',
  weapon_damage: 'Weapon damage bonus',
  weapon_accuracy: 'Accuracy bonus',
  weapon_parry: 'Parry bonus',
  weapon_block: 'Block bonus',
  armor_divisor: 'Armor divisor',
  dr: 'Damage resistance (DR)',
  db: 'Defense bonus (DB)',
  weight_reduction_percent: 'Weight reduction (%)',
  skill: 'Skill bonus',
};

export const ENCHANTMENT_APPLICABILITY_LABELS: Record<EnchantmentApplicability, string> = {
  any: 'Any item',
  weapon: 'Weapons',
  armor: 'Armor',
  shield: 'Shields',
};

const SHORT_LABELS: Partial<Record<EnchantmentEffectTarget, string>> = {
  weapon_attack: 'to attack rolls',
  weapon_damage: 'damage',
  weapon_accuracy: 'Accuracy',
  weapon_parry: 'Parry',
  weapon_block: 'Block',
  dr: 'DR',
  db: 'DB',
};

export function effectText(effect: EnchantmentEffect): string {
  if (effect.target === 'skill') return `${formatSigned(effect.value)} ${effect.skillName ?? ''}`;
  if (effect.target === 'armor_divisor') return `Armor divisor (${effect.value})`;
  if (effect.target === 'weight_reduction_percent') return `${effect.value}% lighter`;
  return `${formatSigned(effect.value)} ${SHORT_LABELS[effect.target] ?? effect.target}`;
}

export function stackingText(mechanics: EnchantmentMechanics): string {
  return mechanics.stackingPolicy.kind === 'stack'
    ? 'Adds to other bonuses'
    : `Only the highest in “${mechanics.stackingPolicy.key}” applies`;
}

function levelName(level: { level: number; label?: string | undefined }) {
  return `Level ${level.level}${level.label ? ` (${level.label})` : ''}`;
}

/** One readable line per rule; the update preview compares these lines. */
export function mechanicsLines(mechanics: EnchantmentMechanics | null | undefined): string[] {
  if (!mechanics) return [];
  return [
    `Applies to: ${ENCHANTMENT_APPLICABILITY_LABELS[mechanics.applicability]}`,
    stackingText(mechanics),
    ...mechanics.effects.map(effectText),
    ...mechanics.levels.flatMap((level) =>
      level.effects.length === 0
        ? [`${levelName(level)}: no effects`]
        : level.effects.map((effect) => `${levelName(level)}: ${effectText(effect)}`),
    ),
  ];
}

export function definitionMechanics(definition: LibraryEnchantmentOut): EnchantmentMechanics {
  return structuredClone({
    applicability: definition.applicability,
    effects: definition.effects,
    levels: definition.levels,
    stackingPolicy: definition.stackingPolicy,
  });
}

/** The linked entry as the server would hydrate it from this definition. */
export function updatedEntry(
  entry: EnchantmentRef,
  definition: LibraryEnchantmentOut,
): EnchantmentRef {
  return {
    ...entry,
    spellName: definition.name,
    definitionRevision: definition.revision >= 0 ? definition.revision : null,
    definitionSource: definition.source,
    mechanics: definitionMechanics(definition),
  };
}

export interface EnchantmentUpdatePreview {
  readonly removed: string[];
  readonly added: string[];
  readonly notes: string[];
}

/**
 * What "Update" changes, or null when the library offers nothing newer. An
 * older local library row never offers a downgrade of a newer snapshot.
 */
export function enchantmentUpdatePreview(
  entry: EnchantmentRef,
  definition: LibraryEnchantmentOut | undefined,
): EnchantmentUpdatePreview | null {
  if (!definition || !entry.definitionId) return null;
  if (entry.definitionRevision != null && definition.revision < entry.definitionRevision)
    return null;
  const next = updatedEntry(entry, definition);
  const before = mechanicsLines(entry.mechanics);
  const after = mechanicsLines(next.mechanics);
  const removed = before.filter((line) => !after.includes(line));
  const added = after.filter((line) => !before.includes(line));
  const notes: string[] = [];
  if (entry.spellName !== next.spellName)
    notes.push(`Name: ${entry.spellName} → ${next.spellName}`);
  if ((entry.definitionSource ?? null) !== (next.definitionSource ?? null))
    notes.push(`Source: ${entry.definitionSource || 'none'} → ${next.definitionSource || 'none'}`);
  const levels = next.mechanics?.levels ?? [];
  if (entry.level != null && levels.length > 0 && !levels.some((l) => l.level === entry.level))
    notes.push(`Level ${entry.level} is no longer defined, so no level effects will apply`);
  if (removed.length === 0 && added.length === 0 && notes.length === 0) return null;
  return { removed, added, notes };
}
