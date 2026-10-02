import { describe, expect, test } from 'bun:test';
import { type CalculationDefinitionV1, calculationDefinition } from '../schemas/calculation.ts';
import {
  type RuleResolver,
  evaluateCalculation,
  fixedCalculation,
  validateCalculation,
} from './calculation.ts';

const output = (
  node: string,
  rounding: 'ceil' | 'floor' | 'nearest' | 'exact' = 'exact',
  increment = 1,
) => ({
  key: 'result',
  unit: 'points' as const,
  node,
  rounding,
  increment,
  min: -10_000,
  max: 10_000,
});
const definition = (
  nodes: CalculationDefinitionV1['nodes'],
  outputs = [output(nodes.at(-1)?.id ?? 'output')],
): CalculationDefinitionV1 => ({
  version: 1,
  inputs: [],
  tables: [],
  nodes,
  outputs,
});
const evaluate = (
  d: CalculationDefinitionV1,
  inputs: Record<string, number | string | boolean> = {},
  resolve?: RuleResolver,
) => evaluateCalculation(d, inputs, resolve).result;

describe('calculation expressions', () => {
  test('evaluates arithmetic, extrema, comparisons, and conditional branches', () => {
    const d = definition(
      [
        { id: 'a', op: 'constant', value: 6 },
        { id: 'b', op: 'constant', value: 3 },
        { id: 'sum', op: 'add', args: ['a', 'b'] },
        { id: 'product', op: 'multiply', args: ['sum', 'b'] },
        { id: 'difference', op: 'subtract', left: 'product', right: 'a' },
        { id: 'quotient', op: 'divide', left: 'difference', right: 'b' },
        { id: 'smallest', op: 'min', args: ['a', 'b', 'quotient'] },
        { id: 'largest', op: 'max', args: ['a', 'b', 'quotient'] },
        { id: 'less', op: 'lt', left: 'smallest', right: 'largest' },
        { id: 'same', op: 'eq', left: 'a', right: 'a' },
        { id: 'atMost', op: 'lte', left: 'b', right: 'b' },
        // biome-ignore lint/suspicious/noThenProperty: The calculation AST uses a `then` branch.
        { id: 'chosen', op: 'if', condition: 'less', then: 'largest', else: 'smallest' },
      ],
      [
        { ...output('sum'), key: 'sum' },
        { ...output('quotient'), key: 'quotient' },
        { ...output('chosen'), key: 'chosen' },
      ],
    );
    expect(evaluateCalculation(d, {})).toEqual({ sum: 9, quotient: 7, chosen: 7 });
    expect(
      evaluateCalculation(
        definition([
          { id: 'a', op: 'constant', value: 7 },
          { id: 'b', op: 'constant', value: 7 },
          { id: 'eq', op: 'eq', left: 'a', right: 'b' },
          { id: 'lte', op: 'lte', left: 'a', right: 'b' },
          // biome-ignore lint/suspicious/noThenProperty: The calculation AST uses a `then` branch.
          { id: 'answer', op: 'if', condition: 'eq', then: 'lteChoice', else: 'b' },
          // biome-ignore lint/suspicious/noThenProperty: The calculation AST uses a `then` branch.
          { id: 'lteChoice', op: 'if', condition: 'lte', then: 'a', else: 'b' },
        ]),
        {},
      ),
    ).toEqual({ result: 7 });
  });

  test('keeps decimal arithmetic exact before output rounding, including negative values', () => {
    const d = definition(
      [
        { id: 'a', op: 'constant', value: 0.1 },
        { id: 'b', op: 'constant', value: 0.2 },
        { id: 'sum', op: 'add', args: ['a', 'b'] },
      ],
      [{ ...output('sum', 'exact', 0.1), min: 0, max: 1 }],
    );
    expect(evaluate(d)).toBe(0.3);
    const negatives = (rounding: 'ceil' | 'floor' | 'nearest') =>
      definition(
        [{ id: 'n', op: 'constant', value: -1.4 }],
        [{ ...output('n', rounding), min: -10, max: 10 }],
      );
    expect(evaluate(negatives('ceil'))).toBe(-1);
    expect(evaluate(negatives('floor'))).toBe(-2);
    expect(evaluate(negatives('nearest'))).toBe(-1);
    const awayFromZero = definition(
      [{ id: 'n', op: 'constant', value: -1.6 }],
      [output('n', 'nearest')],
    );
    expect(evaluate(awayFromZero)).toBe(-2);
    expect(() =>
      evaluate(definition([{ id: 'n', op: 'constant', value: 1.25 }], [output('n', 'exact', 0.1)])),
    ).toThrow(/exact increment/);
  });

  test('evaluates absolute value and expression-level ceil, floor, and nearest rounding', () => {
    const d = definition(
      [
        { id: 'negative', op: 'constant', value: -1.6 },
        { id: 'absolute', op: 'abs', arg: 'negative' },
        { id: 'ceiling', op: 'ceil', arg: 'negative' },
        { id: 'flooring', op: 'floor', arg: 'negative' },
        { id: 'rounded', op: 'round', arg: 'negative' },
      ],
      [
        { ...output('absolute', 'exact', 0.1), key: 'absolute', min: -10, max: 10 },
        { ...output('ceiling'), key: 'ceiling' },
        { ...output('flooring'), key: 'flooring' },
        { ...output('rounded'), key: 'rounded' },
      ],
    );
    expect(evaluateCalculation(d, {})).toEqual({
      absolute: 1.6,
      ceiling: -1,
      flooring: -2,
      rounded: -2,
    });
  });

  test('applies per-die and per-level inputs with declared ranges and steps', () => {
    const d: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        { key: 'dice', label: 'Dice', kind: 'number', unit: 'dice', min: 1, max: 10, step: 1 },
        { key: 'level', label: 'Level', kind: 'number', unit: 'level', min: 0, max: 5, step: 0.5 },
      ],
      tables: [],
      nodes: [
        { id: 'dice', op: 'input', key: 'dice' },
        { id: 'perDie', op: 'constant', value: 2.5 },
        { id: 'diceCost', op: 'multiply', args: ['dice', 'perDie'] },
        { id: 'level', op: 'input', key: 'level' },
        { id: 'perLevel', op: 'constant', value: 3 },
        { id: 'levelCost', op: 'multiply', args: ['level', 'perLevel'] },
        { id: 'total', op: 'add', args: ['diceCost', 'levelCost'] },
      ],
      outputs: [{ ...output('total', 'exact', 0.5), max: 100 }],
    };
    expect(evaluate(d, { dice: 4, level: 2.5 })).toBe(17.5);
    expect(() => evaluate(d, { dice: 2.2, level: 1 })).toThrow(/exact increment/);
    expect(() => evaluate(d, { dice: 11, level: 1 })).toThrow(/outside its range/);
    expect(() => evaluate(d, { dice: 2, level: 1, stray: 1 })).toThrow(/Unknown input/);
  });

  test('validates choice inputs and evaluates table lookups', () => {
    const d: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        {
          key: 'mode',
          label: 'Mode',
          kind: 'choice',
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Heavy', value: 'heavy' },
          ],
        },
      ],
      tables: [
        {
          key: 'weights',
          rows: [
            { key: 'light', value: 2.5 },
            { key: 'heavy', value: 5 },
          ],
        },
      ],
      nodes: [
        { id: 'mode', op: 'input', key: 'mode' },
        { id: 'weight', op: 'lookup', table: 'weights', key: 'mode' },
      ],
      outputs: [{ ...output('weight', 'exact', 0.5), max: 100 }],
    };
    expect(evaluate(d, { mode: 'heavy' })).toBe(5);
    expect(() => evaluate(d, { mode: 'other' })).toThrow(/Invalid choice/);
    expect(() => evaluate(d, {})).toThrow(/Choose Mode/);
    const unmatched = {
      ...d,
      inputs: [
        {
          ...(d.inputs[0] ?? {
            key: 'quality',
            kind: 'choice' as const,
            label: 'Quality',
            options: [],
          }),
          default: 'light',
        },
      ],
    } as CalculationDefinitionV1;
    expect(() => evaluate(unmatched, { mode: 'light' })).not.toThrow();
    const tableMiss = { ...d, tables: [{ key: 'weights', rows: [{ key: 'light', value: 2.5 }] }] };
    expect(() => evaluate(tableMiss, { mode: 'heavy' })).toThrow(/No matching row/);
  });

  test('binds cross-rule inputs and rejects missing, extra, and cyclic rule references', () => {
    const target: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        { key: 'base', label: 'Base', kind: 'number', unit: 'points', min: 0, max: 100, step: 1 },
      ],
      tables: [],
      nodes: [
        { id: 'base', op: 'input', key: 'base' },
        { id: 'two', op: 'constant', value: 2 },
        { id: 'total', op: 'multiply', args: ['base', 'two'] },
      ],
      outputs: [{ ...output('total'), key: 'cost' }],
    };
    const ref = { section: 'traits' as const, key: 'Target', sourceId: null };
    const caller = definition([
      { id: 'value', op: 'constant', value: 7 },
      { id: 'call', op: 'call', reference: ref, output: 'cost', arguments: { base: 'value' } },
    ]);
    const resolver: RuleResolver = () => target;
    expect(evaluate(caller, {}, resolver)).toBe(14);
    const missing = {
      ...caller,
      nodes: [
        caller.nodes[0] ?? { id: 'base', op: 'constant', value: 0 },
        {
          ...(caller.nodes[1] ?? { id: 'call', op: 'call' as const, rule: 'base', arguments: {} }),
          arguments: {},
        },
      ],
    } as CalculationDefinitionV1;
    expect(() => validateCalculation(missing, resolver)).toThrow(/Invalid argument bindings/);
    const extra = {
      ...caller,
      nodes: [
        caller.nodes[0] ?? { id: 'base', op: 'constant', value: 0 },
        {
          ...(caller.nodes[1] ?? { id: 'call', op: 'call' as const, rule: 'base', arguments: {} }),
          arguments: { base: 'value', other: 'value' },
        },
      ],
    } as CalculationDefinitionV1;
    expect(() => validateCalculation(extra, resolver)).toThrow(/Invalid argument bindings/);
    const selfRef: CalculationDefinitionV1 = {
      version: 1,
      inputs: [
        { key: 'base', label: 'Base', kind: 'number', unit: 'points', min: 0, max: 100, step: 1 },
      ],
      tables: [],
      nodes: [
        { id: 'baseInput', op: 'input', key: 'base' },
        {
          id: 'call',
          op: 'call',
          reference: ref,
          output: 'result',
          arguments: { base: 'baseInput' },
        },
      ],
      outputs: [output('call')],
    };
    expect(() => validateCalculation(selfRef, () => selfRef)).toThrow(/Cyclic rule reference/);
    expect(() => validateCalculation(caller, () => undefined)).toThrow(/Unresolved rule/);
  });

  test('rejects expression cycles, malformed references, and graph size/depth beyond limits', () => {
    const cycle = definition(
      [
        { id: 'a', op: 'add', args: ['b'] },
        { id: 'b', op: 'add', args: ['a'] },
      ],
      [output('a')],
    );
    expect(() => validateCalculation(cycle)).toThrow(/Cyclic expression/);
    expect(() =>
      validateCalculation(definition([{ id: 'a', op: 'input', key: 'missing' }])),
    ).toThrow(/Missing input/);
    expect(() =>
      validateCalculation(
        definition([
          { id: 'key', op: 'constant', value: 'x' },
          { id: 'a', op: 'lookup', table: 'missing', key: 'key' },
        ]),
      ),
    ).toThrow(/Missing table/);
    const chain: CalculationDefinitionV1['nodes'] = [{ id: 'n0', op: 'constant', value: 1 }];
    for (let i = 1; i < 33; i++) chain.push({ id: `n${i}`, op: 'abs', arg: `n${i - 1}` });
    expect(() => validateCalculation(definition(chain, [output('n32')]))).toThrow(
      /depth exceeds 32/,
    );
    expect(() =>
      calculationDefinition.parse({
        ...definition([{ id: 'ok', op: 'constant', value: 1 }]),
        nodes: Array.from({ length: 501 }, (_, i) => ({ id: `n${i}`, op: 'constant', value: 1 })),
      }),
    ).toThrow();
    expect(() =>
      validateCalculation({ ...definition([{ id: 'ok', op: 'constant', value: 1 }]), outputs: [] }),
    ).toThrow();
  });

  test('applies the depth limit across nested rule references and expression nodes', () => {
    const chain = new Map<string, CalculationDefinitionV1>();
    for (let index = 0; index < 20; index += 1) {
      const nodes: CalculationDefinitionV1['nodes'] = [{ id: 'seed', op: 'constant', value: 1 }];
      let previous = 'seed';
      if (index === 19) {
        for (let step = 0; step < 15; step += 1) {
          const id = `abs${step}`;
          nodes.push({ id, op: 'abs', arg: previous });
          previous = id;
        }
        chain.set(`nested-${index}`, definition(nodes, [output(previous)]));
        continue;
      }
      nodes.push({
        id: 'nested',
        op: 'call',
        reference: { section: 'traits', key: `nested-${index + 1}`, sourceId: null },
        output: 'result',
        arguments: {},
      });
      chain.set(`nested-${index}`, definition(nodes, [output('nested')]));
    }
    const root = chain.get('nested-0');
    if (!root) throw new Error('root calculation fixture missing');
    expect(() => validateCalculation(root, (reference) => chain.get(reference.key))).toThrow(
      /depth exceeds 32/,
    );
  });

  test('preserves fine fixed modifier and subnormal currency precision', () => {
    const modifier = fixedCalculation({ modifier: { value: 0.001, unit: 'percentage' } });
    validateCalculation(modifier);
    expect(evaluateCalculation(modifier, {})).toEqual({ modifier: 0.001 });

    const currency = fixedCalculation({ cost: { value: Number.MIN_VALUE, unit: 'currency' } });
    validateCalculation(currency);
    expect(evaluateCalculation(currency, {}).cost).toBe(Number.MIN_VALUE);
  });

  test('reads reserved input names only from own properties or declared defaults', () => {
    const reservedInput = definition(
      [{ id: 'value', op: 'input', key: 'constructor' }],
      [output('value')],
    );
    reservedInput.inputs.push({
      key: 'constructor',
      kind: 'number',
      label: 'Constructor',
      unit: 'count',
      min: 0,
      max: 10,
      step: 1,
      default: 3,
    });
    expect(evaluateCalculation(reservedInput, {})).toEqual({ result: 3 });
    expect(evaluateCalculation(reservedInput, { constructor: 5 })).toEqual({ result: 5 });

    const missing = structuredClone(reservedInput);
    const input = missing.inputs[0];
    if (input?.kind === 'number') input.default = undefined;
    expect(() => evaluateCalculation(missing, {})).toThrow(/Choose Constructor/);
  });
});
