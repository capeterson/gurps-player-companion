import { z } from 'zod';

/** Runtime schemas are the authoring domain, including every union branch. */
export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  )
    return unwrapSchema(schema._def.innerType);
  if (schema instanceof z.ZodEffects) return unwrapSchema(schema._def.schema);
  if (schema instanceof z.ZodLazy) return unwrapSchema(schema._def.getter());
  return schema;
}

export function schemaChoices(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const base = unwrapSchema(schema);
  if (base instanceof z.ZodUnion) return base.options.flatMap(schemaChoices);
  if (base instanceof z.ZodDiscriminatedUnion) return [...base.options];
  return [base];
}

export function objectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  const base = unwrapSchema(schema);
  return base instanceof z.ZodObject ? base.shape : {};
}

export function seedSchema(schema: z.ZodTypeAny, depth = 0): unknown {
  if (schema instanceof z.ZodDefault) return schema._def.defaultValue();
  if (schema instanceof z.ZodOptional) return undefined;
  if (schema instanceof z.ZodNullable) return null;
  const base = unwrapSchema(schema);
  if (depth > 12) return undefined;
  if (base instanceof z.ZodLiteral) return base.value;
  if (base instanceof z.ZodNull) return null;
  if (base instanceof z.ZodUndefined) return undefined;
  if (base instanceof z.ZodEnum) return base.options[0];
  if (base instanceof z.ZodString) return '';
  if (base instanceof z.ZodNumber) return Math.max(0, base.minValue ?? 0);
  if (base instanceof z.ZodBoolean) return false;
  if (base instanceof z.ZodArray) {
    return Array.from({ length: base._def.minLength?.value ?? 0 }, () =>
      seedSchema(base.element, depth + 1),
    );
  }
  if (base instanceof z.ZodRecord) return {};
  if (base instanceof z.ZodObject) {
    return Object.fromEntries(
      Object.entries(base.shape as Record<string, z.ZodTypeAny>).map(([key, child]) => [
        key,
        seedSchema(child, depth + 1),
      ]),
    );
  }
  return seedSchema(schemaChoices(base)[0] ?? z.string(), depth + 1);
}

export function choiceTag(schema: z.ZodTypeAny): string {
  const base = unwrapSchema(schema);
  if (base instanceof z.ZodObject) {
    for (const key of ['kind', 'op']) {
      const child = unwrapSchema(base.shape[key] ?? z.undefined());
      if (child instanceof z.ZodLiteral) return String(child.value);
      if (child instanceof z.ZodEnum) return child.options.join('/');
    }
    return 'calculation' in base.shape ? 'Calculated cost' : 'Fixed cost';
  }
  if (base instanceof z.ZodNumber) return 'number';
  if (base instanceof z.ZodBoolean) return 'boolean';
  if (base instanceof z.ZodString) return 'text';
  return 'Definition';
}

export function matchesChoice(schema: z.ZodTypeAny, value: unknown): boolean {
  const base = unwrapSchema(schema);
  if (base instanceof z.ZodObject && value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of ['kind', 'op']) {
      const child = unwrapSchema(base.shape[key] ?? z.undefined());
      if (child instanceof z.ZodLiteral) return row[key] === child.value;
      if (child instanceof z.ZodEnum) return child.options.includes(String(row[key]));
    }
    if ('calculation' in row) return 'calculation' in base.shape;
    return !('calculation' in base.shape);
  }
  return (
    (base instanceof z.ZodNumber && typeof value === 'number') ||
    (base instanceof z.ZodBoolean && typeof value === 'boolean') ||
    (base instanceof z.ZodString && typeof value === 'string')
  );
}

const LABELS: Record<string, string> = {
  name: 'Name',
  basePoints: 'Base points',
  pointsPerLevel: 'Points per level',
  maxLevel: 'Maximum level',
  pointCostMultiplier: 'Cost multiplier',
  pointCostDelta: 'Cost adjustment',
  techLevel: 'Tech level',
  techLevelPolicy: 'TL policy',
  suggestedFrom: 'Suggest learned TL from',
  defaultSpecialization: 'Default specialization',
  specializationPolicy: 'Specializations',
  prerequisiteRules: 'Prerequisite rules',
  minimumRelativeLevel: 'Minimum relative level',
  minimumAbsoluteLevel: 'Minimum absolute level',
  minimumPoints: 'Minimum points',
  minimumLevel: 'Minimum level',
  skill_group: 'Skill group',
  skill_tag: 'Skill tag',
  campaign_rule: 'Campaign rule',
  gm_permission: 'GM permission',
  tech_level: 'Tech level',
  all: 'All of these',
  any: 'Any of these',
  children: 'Requirements',
  not_applicable: 'Not applicable',
  required: 'Required /TL',
  fixed: 'Fixed',
  none: 'None',
  required_catalog: 'Required catalog',
  optional_catalog: 'Optional catalog',
  required_freeform: 'Required free form',
  optional_freeform: 'Optional free form',
  per_difference: 'Per difference',
  task_roll: 'Task roll',
  base_level: 'Base level',
  exclusive_group: 'Exclusive group',
  sourceText: 'Source text',
  appliesTo: 'Applies to',
  groupCap: 'Group total limits',
  cap: 'Limits',
  per_level: 'Per level',
  costValue: 'Fixed value',
  costType: 'Cost type',
  maxEnergy: 'Capacity',
  currentEnergy: 'Starting energy',
  spellName: 'Spell',
  spellSkillLevel: 'Casting skill',
  chargesMax: 'Maximum charges',
  chargesCurrent: 'Starting charges',
  energyCost: 'Energy cost',
  spellLevel: 'Item Power',
  level: 'Level',
  category: 'Category',
  wieldedSide: 'Held side',
  traitKinds: 'Trait kinds',
  traitTags: 'Trait tags',
  traits: 'Specific traits',
  universal: 'All traits',
  locator: 'Excerpt location',
  modifiers: 'Contextual modifiers',
  actions: 'Actions',
  benefits: 'Level benefits',
  outputs: 'Outputs',
  inputs: 'Inputs',
  nodes: 'Calculation steps',
  tables: 'Lookup tables',
  id: 'Rule name',
  key: 'Name',
  op: 'Operation',
  args: 'Operands',
  eq: 'Equals',
  lt: 'Less than',
  lte: 'Less than or equal',
  if: 'If / then / else',
  call: 'Use another definition',
  // biome-ignore lint/suspicious/noThenProperty: label for a declarative expression branch.
  then: 'When true',
  else: 'When false',
  minimumMargin: 'Minimum margin',
  maximumMargin: 'Maximum margin',
  costs: 'Resource costs',
  contest: 'Contest',
  other_skill: 'Another skill',
  prose_only: 'Prose only',
  defaultQuantity: 'Quantity',
  weightLbs: 'Weight (lb)',
  baseEnergyCost: 'Energy cost',
  maintenanceCost: 'Maintenance cost',
  defaultSkillName: 'Default skill',
  defaultModifier: 'Default modifier',
  skills: 'Skills',
  perks: 'Perks',
  conditionGroup: 'Condition group',
  conditionLabel: 'Condition label',
  parameters: 'Details',
  features: 'Features',
  attributeModifiers: 'Attribute adjustments',
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hp: 'HP',
  fp: 'FP',
  speedQuarter: 'Basic Speed (quarter points)',
  sizeModifier: 'Size Modifier',
  will: 'Will',
  per: 'Per',
};
export function editorLabel(key: string): string {
  return (
    LABELS[key] ??
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
