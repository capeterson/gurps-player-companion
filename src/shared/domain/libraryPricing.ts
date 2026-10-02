import { calculationDefinition } from '../schemas/calculation.ts';
import type {
  CalculationDefinitionV1,
  CalculationInputs,
  PricingResolution,
  RuleReference,
} from '../schemas/calculation.ts';
import type { LibraryMetadata } from '../schemas/libraryMetadata.ts';
import type { TraitModifier } from '../schemas/trait.ts';
import {
  evaluateCalculation,
  fixedCalculation,
  legacyTraitCalculation,
  referenceKey,
  validateCalculation,
} from './calculation.ts';
import { canAdoptLibraryEntry, canonicalLibraryKey } from './libraryIdentity.ts';
import { normalizeWeaponData } from './weaponModes.ts';

export interface PricedDefinition extends LibraryMetadata {
  id?: string | undefined;
  revision?: number | undefined;
  name: string;
  kind?: string | undefined;
  calculation?: CalculationDefinitionV1 | null | undefined;
  basePoints?: number | undefined;
  pointsPerLevel?: number | null | undefined;
  maxLevel?: number | null | undefined;
  cost?: number | string | undefined;
  weightLbs?: number | string | undefined;
  category?: string | undefined;
  description?: string | null | undefined;
  group?: string | null | undefined;
  availableModifiers?: readonly TraitModifier[] | undefined;
  costType?: 'percent' | 'flat' | undefined;
}
export type PricingCatalog = {
  traits: readonly PricedDefinition[];
  items: readonly PricedDefinition[];
  modifiers: readonly PricedDefinition[];
};
export function definitionReference(
  section: RuleReference['section'],
  entry: PricedDefinition,
): RuleReference {
  return {
    section,
    key: entry.key || canonicalLibraryKey(entry.name),
    sourceId: entry.sourceId ?? null,
    ...(section === 'traits' && entry.kind ? { kind: entry.kind } : {}),
  };
}
export function definitionCalculation(
  section: RuleReference['section'],
  entry: PricedDefinition,
): CalculationDefinitionV1 | null {
  if (entry.calculation) return entry.calculation;
  if (!canAdoptLibraryEntry(entry)) return null;
  if (section === 'traits')
    return legacyTraitCalculation(entry.basePoints ?? 0, entry.pointsPerLevel, entry.maxLevel);
  if (section === 'items')
    return fixedCalculation({
      cost: { value: Number(entry.cost ?? 0), unit: 'currency' },
      weightLbs: { value: Number(entry.weightLbs ?? 0), unit: 'pounds' },
    });
  return null;
}
export function findPricedDefinition(
  catalog: PricingCatalog,
  ref: RuleReference,
): PricedDefinition | undefined {
  const matches = catalog[ref.section].filter((entry) => {
    const reference = definitionReference(ref.section, entry);
    return (
      referenceKey(ref.kind ? reference : { ...reference, kind: undefined }) === referenceKey(ref)
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export function validatePricingCatalog(catalog: PricingCatalog): void {
  const resolver = (ref: RuleReference) => {
    const entry = findPricedDefinition(catalog, ref);
    return entry && canAdoptLibraryEntry(entry)
      ? (definitionCalculation(ref.section, entry) ?? undefined)
      : undefined;
  };
  const validateRule = (rule: CalculationDefinitionV1) => {
    const dependencies = new Set<string>();
    validateCalculation(rule, (ref) => {
      dependencies.add(referenceKey(ref));
      if (dependencies.size > 100) throw new Error('Too many rule dependencies');
      return resolver(ref);
    });
  };
  for (const section of ['traits', 'items', 'modifiers'] as const)
    for (const entry of catalog[section]) {
      if (section === 'traits')
        for (const modifier of entry.availableModifiers ?? []) {
          if (modifier.calculation) {
            validateRule(modifier.calculation);
            if (
              !modifier.calculation.outputs.some(
                (o) =>
                  o.key === 'modifier' &&
                  o.unit === (modifier.costType === 'flat' ? 'points' : 'percentage'),
              )
            )
              throw new Error('Incompatible trait-local modifier output');
          }
        }
      const rule = definitionCalculation(section, entry);
      if (!rule) {
        if (canAdoptLibraryEntry(entry))
          throw new Error(`${entry.name} requires a calculation rule`);
        continue;
      }
      // Raw unfinished material belongs in extraction evidence, not an invalid rule graph.
      validateRule(rule);
      const expected =
        section === 'traits'
          ? [['points', 'points']]
          : section === 'items'
            ? [
                ['cost', 'currency'],
                ['weightLbs', 'pounds'],
              ]
            : [['modifier', entry.costType === 'flat' ? 'points' : 'percentage']];
      if (
        expected.some(
          ([key, unit]) =>
            !rule.outputs.some((output) => output.key === key && output.unit === unit),
        )
      )
        throw new Error(`${entry.name} has incompatible pricing outputs`);
    }
}
export function resolveLibraryPricing(
  catalog: PricingCatalog,
  ref: RuleReference,
  inputs: CalculationInputs,
): PricingResolution {
  const entry = findPricedDefinition(catalog, ref);
  if (!entry?.id || !canAdoptLibraryEntry(entry))
    throw new Error('Library entry is incomplete or unavailable');
  const definition = definitionCalculation(ref.section, entry);
  if (!definition) throw new Error('Library entry has no calculation rule');
  const dependencies = new Map<string, PricingResolution['dependencies'][number]>();
  const resolver = (reference: RuleReference) => {
    const target = findPricedDefinition(catalog, reference);
    if (!target || !canAdoptLibraryEntry(target)) return undefined;
    const rule = definitionCalculation(reference.section, target);
    if (!rule) return undefined;
    dependencies.set(referenceKey(reference), {
      reference,
      definition: rule,
      revision: target.revision != null && target.revision >= 0 ? target.revision : null,
    });
    if (dependencies.size > 100) throw new Error('Too many rule dependencies');
    return rule;
  };
  const outputs = evaluateCalculation(definition, inputs, resolver);
  return {
    reference: ref,
    definitionId: entry.id,
    revision: entry.revision != null && entry.revision >= 0 ? entry.revision : null,
    inputs: Object.fromEntries(
      definition.inputs.map((input) => {
        const chosen = Object.hasOwn(inputs, input.key) ? inputs[input.key] : input.default;
        if (chosen === undefined) throw new Error(`Missing input: ${input.key}`);
        return [input.key, chosen];
      }),
    ),
    outputs,
    definition,
    dependencies: [...dependencies.values()],
  };
}

/** Trait-local modifiers retain the parent edition and revision as provenance. */
export function resolveLocalModifier(
  catalog: PricingCatalog,
  trait: PricedDefinition,
  name: string,
  inputs: CalculationInputs,
): PricingResolution {
  const modifier = trait.availableModifiers?.find((m) => m.name === name);
  if (!trait.id || !modifier || !canAdoptLibraryEntry(trait))
    throw new Error('Trait-local modifier unavailable');
  const definition =
    modifier.calculation ??
    fixedCalculation({
      modifier: {
        value: modifier.costValue,
        unit: modifier.costType === 'flat' ? 'points' : 'percentage',
      },
    });
  const dependencies = new Map<string, PricingResolution['dependencies'][number]>();
  const outputs = evaluateCalculation(definition, inputs, (ref) => {
    const entry = findPricedDefinition(catalog, ref);
    if (!entry || !canAdoptLibraryEntry(entry)) return undefined;
    const rule = definitionCalculation(ref.section, entry);
    if (!rule) return undefined;
    dependencies.set(referenceKey(ref), {
      reference: ref,
      definition: rule,
      revision: entry.revision != null && entry.revision >= 0 ? entry.revision : null,
    });
    if (dependencies.size > 100) throw new Error('Too many rule dependencies');
    return rule;
  });
  if (
    outputs.modifier === undefined ||
    !definition.outputs.some(
      (o) =>
        o.key === 'modifier' && o.unit === (modifier.costType === 'flat' ? 'points' : 'percentage'),
    )
  )
    throw new Error('Invalid modifier output');
  return {
    reference: definitionReference('traits', trait),
    definitionId: trait.id,
    localModifier: name,
    revision: trait.revision != null && trait.revision >= 0 ? trait.revision : null,
    definition,
    inputs: Object.fromEntries(
      definition.inputs.map((input) => {
        const chosen = Object.hasOwn(inputs, input.key) ? inputs[input.key] : input.default;
        if (chosen === undefined) throw new Error(`Missing input: ${input.key}`);
        return [input.key, chosen];
      }),
    ),
    outputs,
    dependencies: [...dependencies.values()],
  };
}
const canonicalRuleJson = (rule: CalculationDefinitionV1) =>
  JSON.stringify(calculationDefinition.parse(rule), (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
export function pricingSourceChanged(
  catalog: PricingCatalog,
  snapshot: PricingResolution,
): boolean {
  const source = findPricedDefinition(catalog, snapshot.reference);
  if (!source || source.id !== snapshot.definitionId) return true;
  const same = (a: CalculationDefinitionV1 | null, b: CalculationDefinitionV1) =>
    a !== null && canonicalRuleJson(a) === canonicalRuleJson(b);
  const local = snapshot.localModifier
    ? source.availableModifiers?.find((m) => m.name === snapshot.localModifier)
    : undefined;
  const rule = snapshot.localModifier
    ? local
      ? (local.calculation ??
        fixedCalculation({
          modifier: {
            value: local.costValue,
            unit: local.costType === 'flat' ? 'points' : 'percentage',
          },
        }))
      : null
    : definitionCalculation(snapshot.reference.section, source);
  if (
    !same(rule, snapshot.definition) ||
    (snapshot.revision !== null && source.revision !== snapshot.revision)
  )
    return true;
  return snapshot.dependencies.some((dependency) => {
    const target = findPricedDefinition(catalog, dependency.reference);
    return (
      !target ||
      !same(definitionCalculation(dependency.reference.section, target), dependency.definition) ||
      (dependency.revision !== null && target.revision !== dependency.revision)
    );
  });
}

export function normalizePricingWrite(
  section: string,
  body: Record<string, unknown>,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const patch = { ...body };
  const entry = { ...existing, ...body } as unknown as PricedDefinition;
  if (body.key && typeof body.key === 'string') patch.key = canonicalLibraryKey(body.key);
  if (section === 'traits' && body.availableModifiers !== undefined)
    patch.availableModifiers = (body.availableModifiers as TraitModifier[]).map((m) => ({
      ...m,
      calculation:
        m.calculation ??
        fixedCalculation({
          modifier: { value: m.costValue, unit: m.costType === 'flat' ? 'points' : 'percentage' },
        }),
    }));
  const legacy =
    section === 'traits' ? ['basePoints', 'pointsPerLevel', 'maxLevel'] : ['cost', 'weightLbs'];
  if (
    (section === 'traits' || section === 'items') &&
    body.calculation === undefined &&
    (!existing || legacy.some((k) => body[k] !== undefined))
  ) {
    patch.calculation = definitionCalculation(section, { ...entry, calculation: null });
  }
  if (section === 'items' && body.weaponData !== undefined)
    patch.weaponData = normalizeWeaponData(
      body.weaponData as Parameters<typeof normalizeWeaponData>[0],
    );
  return patch;
}
