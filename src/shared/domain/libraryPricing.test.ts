import { describe, expect, test } from 'bun:test';
import type { CalculationDefinitionV1, RuleReference } from '../schemas/calculation.ts';
import { evaluateCalculation, fixedCalculation } from './calculation.ts';
import {
  type PricedDefinition,
  type PricingCatalog,
  definitionCalculation,
  definitionReference,
  pricingSourceChanged,
  resolveLibraryPricing,
  resolveLocalModifier,
  validatePricingCatalog,
} from './libraryPricing.ts';

const CORE_ID = '0193b3c0-f1f0-7000-8000-00000000a201';

const trait = (overrides: Partial<PricedDefinition> = {}): PricedDefinition => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Acute Vision',
  key: 'acute-vision',
  kind: 'advantage',
  basePoints: 4,
  ...overrides,
});
const catalog = (overrides: Partial<PricingCatalog> = {}): PricingCatalog => ({
  traits: [],
  items: [],
  modifiers: [],
  ...overrides,
});
const pointOutput = (node: string, key = 'points') => ({
  key,
  unit: 'points' as const,
  node,
  rounding: 'exact' as const,
  increment: 1,
  min: -10_000,
  max: 10_000,
});

describe('library pricing', () => {
  test('provides legacy trait and item calculations only for adoptable definitions', () => {
    const leveled = definitionCalculation('traits', trait({ pointsPerLevel: 3, maxLevel: 5 }));
    expect(leveled).not.toBeNull();
    if (!leveled) throw new Error('expected a leveled rule');
    expect(evaluateCalculation(leveled, { level: 2 })).toEqual({ points: 10 });
    expect(definitionCalculation('traits', trait({ role: 'example' }))).toBeNull();

    const item = definitionCalculation('items', trait({ cost: '12.50', weightLbs: 3.25 }));
    expect(item).not.toBeNull();
    if (!item) throw new Error('expected an item rule');
    expect(evaluateCalculation(item, {})).toEqual({ cost: 12.5, weightLbs: 3.25 });
    expect(definitionCalculation('modifiers', trait({ costType: 'percent' }))).toBeNull();
  });

  test('builds canonical references and finds source/kind-specific entries', () => {
    const entry = trait({ key: 'acute vision', sourceId: CORE_ID, kind: 'advantage' });
    expect(definitionReference('traits', entry)).toEqual({
      section: 'traits',
      key: 'acute vision',
      sourceId: CORE_ID,
      kind: 'advantage',
    });
    const ref: RuleReference = {
      section: 'traits',
      key: 'ACUTE VISION',
      sourceId: CORE_ID,
      kind: 'advantage',
    };
    const result = resolveLibraryPricing(catalog({ traits: [entry] }), ref, {});
    expect(result.definitionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.reference).toEqual(ref);
    expect(result.outputs).toEqual({ points: 4 });
    expect(() =>
      resolveLibraryPricing(
        catalog({ traits: [entry] }),
        { ...ref, sourceId: '0193b3c0-f1f0-7000-8000-00000000a202' },
        {},
      ),
    ).toThrow(/incomplete or unavailable/);
  });

  test('snapshots reserved-name defaults as own input values', () => {
    const rule: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        {
          key: 'constructor',
          kind: 'number',
          label: 'Constructor',
          unit: 'count',
          min: 0,
          max: 10,
          step: 1,
          default: 3,
        },
      ],
      tables: [],
      nodes: [{ id: 'value', op: 'input', key: 'constructor' }],
      outputs: [pointOutput('value')],
    };
    const entry = trait({ calculation: rule });
    const snapshot = resolveLibraryPricing(
      catalog({ traits: [entry] }),
      definitionReference('traits', entry),
      {},
    );
    expect(snapshot.inputs).toEqual({ constructor: 3 });
    expect(Object.hasOwn(snapshot.inputs, 'constructor')).toBe(true);
  });

  test('resolves parameterized cross-entry calculations and records dependency revisions', () => {
    const dependencyRule: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        { key: 'level', label: 'Level', kind: 'number', unit: 'level', min: 0, max: 10, step: 1 },
      ],
      tables: [],
      nodes: [
        { id: 'level', op: 'input', key: 'level' },
        { id: 'two', op: 'constant', value: 2 },
        { id: 'points', op: 'multiply', args: ['level', 'two'] },
      ],
      outputs: [pointOutput('points')],
    };
    const dependency = trait({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Training',
      key: 'training',
      calculation: dependencyRule,
      revision: 8,
    });
    const dependencyRef: RuleReference = {
      section: 'traits',
      key: 'training',
      sourceId: null,
      kind: 'advantage',
    };
    const mainRule: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        { key: 'rank', label: 'Rank', kind: 'number', unit: 'level', min: 0, max: 10, step: 1 },
      ],
      tables: [],
      nodes: [
        { id: 'rank', op: 'input', key: 'rank' },
        {
          id: 'training',
          op: 'call',
          reference: dependencyRef,
          output: 'points',
          arguments: { level: 'rank' },
        },
        { id: 'base', op: 'constant', value: 5 },
        { id: 'points', op: 'add', args: ['base', 'training'] },
      ],
      outputs: [pointOutput('points')],
    };
    const main = trait({ calculation: mainRule });
    const resolved = resolveLibraryPricing(
      catalog({ traits: [main, dependency] }),
      { section: 'traits', key: 'acute-vision', sourceId: null, kind: 'advantage' },
      { rank: 3 },
    );
    expect(resolved.outputs).toEqual({ points: 11 });
    expect(resolved.dependencies).toEqual([
      { reference: dependencyRef, definition: dependencyRule, revision: 8 },
    ]);
  });

  test('snapshots local modifier pricing and detects changes to its parent or referenced definitions', () => {
    const dependencyRule = fixedCalculation({ modifier: { value: 5, unit: 'percentage' } });
    const dependency = {
      name: 'Base modifier',
      key: 'base-modifier',
      revision: 3,
      costType: 'percent' as const,
      calculation: dependencyRule,
    };
    const dependencyRef: RuleReference = {
      section: 'modifiers',
      key: 'base-modifier',
      sourceId: null,
    };
    const localRule: CalculationDefinitionV1 = {
      version: 1,
      inputs: [],
      tables: [],
      nodes: [
        { id: 'base', op: 'call', reference: dependencyRef, output: 'modifier', arguments: {} },
        { id: 'bonus', op: 'constant', value: 10 },
        { id: 'total', op: 'add', args: ['base', 'bonus'] },
      ],
      outputs: [
        {
          key: 'modifier',
          unit: 'percentage',
          node: 'total',
          rounding: 'exact',
          increment: 0.01,
          min: -200,
          max: 100_000_000_000,
        },
      ],
    };
    const parent = trait({
      revision: 4,
      availableModifiers: [
        {
          name: 'Improved',
          category: 'enhancement',
          costType: 'percent',
          costValue: 0,
          calculation: localRule,
        },
      ],
    });
    const source = catalog({ traits: [parent], modifiers: [dependency] });
    const snapshot = resolveLocalModifier(source, parent, 'Improved', {});
    expect(snapshot.localModifier).toBe('Improved');
    expect(snapshot.definitionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(snapshot.revision).toBe(4);
    expect(snapshot.outputs).toEqual({ modifier: 15 });
    expect(snapshot.dependencies).toEqual([
      { reference: dependencyRef, definition: dependencyRule, revision: 3 },
    ]);
    expect(pricingSourceChanged(source, snapshot)).toBe(false);
    expect(pricingSourceChanged(source, { ...snapshot, revision: 2 })).toBe(true);

    const changedRule = structuredClone(localRule);
    const bonusNode = changedRule.nodes.find((node) => node.id === 'bonus');
    if (bonusNode?.op === 'constant') bonusNode.value = 11;
    const changedParent = {
      ...parent,
      availableModifiers: [
        {
          name: 'Improved',
          category: 'enhancement' as const,
          costType: 'percent' as const,
          costValue: 0,
          calculation: changedRule,
        },
      ],
    };
    expect(
      pricingSourceChanged(catalog({ traits: [changedParent], modifiers: [dependency] }), snapshot),
    ).toBe(true);

    const speculativeParent = { ...parent, revision: -1 };
    const speculativeCatalog = catalog({ traits: [speculativeParent], modifiers: [dependency] });
    const speculativeSnapshot = resolveLocalModifier(
      speculativeCatalog,
      speculativeParent,
      'Improved',
      {},
    );
    expect(speculativeSnapshot.revision).toBeNull();
    expect(
      pricingSourceChanged(
        catalog({ traits: [{ ...speculativeParent, revision: 5 }], modifiers: [dependency] }),
        speculativeSnapshot,
      ),
    ).toBe(false);

    expect(
      pricingSourceChanged(
        catalog({ traits: [parent], modifiers: [{ ...dependency, revision: 4 }] }),
        snapshot,
      ),
    ).toBe(true);
    expect(() => resolveLocalModifier(source, parent, 'Missing', {})).toThrow(/unavailable/);
  });

  test('evaluates a heavily shared expression DAG once per node', () => {
    const nodes: CalculationDefinitionV1['nodes'] = [{ id: 'n0', op: 'constant', value: 1 }];
    for (let index = 1; index <= 18; index++)
      nodes.push({ id: `n${index}`, op: 'add', args: [`n${index - 1}`, `n${index - 1}`] });
    const sharedDag = {
      version: 1 as const,
      inputs: [],
      tables: [],
      nodes,
      outputs: [{ ...pointOutput('n18'), min: 0, max: 1_000_000 }],
    } satisfies CalculationDefinitionV1;
    expect(evaluateCalculation(sharedDag, {})).toEqual({ points: 262_144 });
  });

  test('validates section-specific required outputs and adoption readiness', () => {
    const validModifier = {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Enhancement',
      costType: 'percent' as const,
      calculation: fixedCalculation({ modifier: { value: 20, unit: 'percentage' } }),
    };
    expect(() =>
      validatePricingCatalog(
        catalog({
          traits: [trait()],
          items: [trait({ name: 'Rope', cost: 10, weightLbs: 1 })],
          modifiers: [validModifier],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validatePricingCatalog(
        catalog({
          modifiers: [
            {
              ...validModifier,
              calculation: fixedCalculation({ modifier: { value: 20, unit: 'points' } }),
            },
          ],
        }),
      ),
    ).toThrow(/incompatible pricing outputs/);
    expect(() =>
      validatePricingCatalog(catalog({ modifiers: [{ name: 'Unpriced', costType: 'percent' }] })),
    ).toThrow(/requires a calculation rule/);
    expect(() =>
      validatePricingCatalog(catalog({ traits: [trait({ role: 'example', calculation: null })] })),
    ).not.toThrow();
    const unresolvedLocalRule: CalculationDefinitionV1 = {
      version: 1,
      inputs: [],
      tables: [],
      nodes: [
        {
          id: 'missing',
          op: 'call',
          reference: { section: 'traits', key: 'absent', sourceId: null, kind: 'advantage' },
          output: 'points',
          arguments: {},
        },
      ],
      outputs: [pointOutput('missing', 'modifier')],
    };
    expect(() =>
      validatePricingCatalog(
        catalog({
          traits: [
            trait({
              status: 'needs_review',
              availableModifiers: [
                {
                  name: 'unfinished',
                  category: 'enhancement',
                  costType: 'flat',
                  costValue: 0,
                  calculation: unresolvedLocalRule,
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/Unresolved rule/);
  });
});
