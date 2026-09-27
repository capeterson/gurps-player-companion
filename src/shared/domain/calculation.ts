import {
  type CalculationDefinitionV1,
  type CalculationInputs,
  type CalculationNode,
  type RuleReference,
  calculationDefinition,
} from '../schemas/calculation.ts';

import { canonicalLibraryKey } from './libraryIdentity.ts';

/** Exact rational arithmetic. Decimal inputs become integer ratios, never floats in calculations. */
class Decimal {
  constructor(
    readonly n: bigint,
    readonly d: bigint = 1n,
  ) {
    if (d === 0n) throw new Error('Division by zero');
    if (n.toString().length > 2000 || d.toString().length > 2000)
      throw new Error('Calculation magnitude limit exceeded');
  }
  static from(value: number): Decimal {
    if (!Number.isFinite(value)) throw new Error('Non-finite number');
    const [mantissa = '', exponent = '0'] = String(value).split('e');
    const digits = mantissa.replace('.', '');
    const scale = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
    return scale < 0
      ? new Decimal(BigInt(digits) * 10n ** BigInt(-scale))
      : new Decimal(BigInt(digits), 10n ** BigInt(scale));
  }
  add(b: Decimal) {
    return fraction(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  mul(b: Decimal) {
    return fraction(this.n * b.n, this.d * b.d);
  }
  div(b: Decimal) {
    return fraction(this.n * b.d, this.d * b.n);
  }
  compare(b: Decimal) {
    const n = this.n * b.d - b.n * this.d;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  }
  round(mode: 'ceil' | 'floor' | 'nearest' | 'exact'): Decimal {
    const q = this.n / this.d;
    const r = this.n % this.d;
    if (mode === 'exact') {
      if (r !== 0n) throw new Error('Result is not an exact increment');
      return new Decimal(q);
    }
    if (!r) return new Decimal(q);
    if (mode === 'floor') return new Decimal(q - (r < 0n ? 1n : 0n));
    if (mode === 'ceil') return new Decimal(q + (r > 0n ? 1n : 0n));
    return this.add(new Decimal(1n, 2n)).round('floor');
  }
  number() {
    const sign = this.n < 0n ? -1 : 1;
    const abs = this.n < 0n ? -this.n : this.n;
    const whole = abs / this.d;
    const fractionDigits = ((abs % this.d) * 10n ** 340n) / this.d;
    const n = sign * Number(`${whole}.${fractionDigits.toString().padStart(340, '0')}`);
    if (!Number.isFinite(n)) throw new Error('Non-finite result');
    return n;
  }
}
function fraction(numerator: bigint, denominator: bigint): Decimal {
  if (denominator === 0n) throw new Error('Division by zero');
  const n = denominator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return new Decimal(n / a, d / a);
}
type Value = Decimal | string | boolean;
const numeric = (v: Value): Decimal => {
  if (!(v instanceof Decimal)) throw new Error('Expected a numeric expression');
  return v;
};
const value = (v: number | string | boolean): Value =>
  typeof v === 'number' ? Decimal.from(v) : v;
const equal = (a: Value, b: Value) =>
  a instanceof Decimal && b instanceof Decimal ? a.compare(b) === 0 : a === b;
export const referenceKey = (ref: RuleReference) =>
  JSON.stringify([
    ref.section,
    ref.kind ?? '',
    canonicalLibraryKey(ref.key),
    canonicalLibraryKey(ref.sourceKey ?? ''),
  ]);
export type RuleResolver = (ref: RuleReference) => CalculationDefinitionV1 | undefined;
export function nodeChildren(node: CalculationNode): string[] {
  if ('args' in node) return node.args;
  if ('left' in node) return [node.left, node.right];
  if ('arg' in node) return [node.arg];
  if (node.op === 'if') return [node.condition, node.then, node.else];
  if (node.op === 'lookup') return [node.key];
  if (node.op === 'call') return Object.values(node.arguments);
  return [];
}
export function validateCalculation(
  definition: CalculationDefinitionV1,
  resolve?: RuleResolver,
  stack: string[] = [],
  budget = { remaining: 10000 },
): number {
  if (stack.length >= 32) throw new Error('Calculation depth exceeds 32');
  if (--budget.remaining < 0) throw new Error('Calculation validation limit exceeded');
  const d = calculationDefinition.parse(definition);
  for (const [label, keys] of [
    ['input', d.inputs.map((x) => x.key)],
    ['node', d.nodes.map((x) => x.id)],
    ['table', d.tables.map((x) => x.key)],
    ['output', d.outputs.map((x) => x.key)],
  ] as const) {
    if (new Set(keys).size !== keys.length) throw new Error(`Duplicate ${label} key`);
  }
  for (const input of d.inputs) {
    if (input.kind === 'number' && input.min > input.max)
      throw new Error(`Invalid range for ${input.label}`);
    const defaultValue = input.default;
    if (defaultValue !== undefined) {
      if (input.kind === 'number') {
        if (typeof defaultValue !== 'number') throw new Error('Numeric default required');
        const n = Decimal.from(defaultValue);
        const min = Decimal.from(input.min);
        if (n.compare(min) < 0 || n.compare(Decimal.from(input.max)) > 0)
          throw new Error('Default is outside input range');
        n.add(min.mul(new Decimal(-1n)))
          .div(Decimal.from(input.step))
          .round('exact');
      } else if (
        input.kind === 'choice' &&
        !input.options.some((o) => equal(value(o.value), value(defaultValue)))
      )
        throw new Error('Default is not an allowed choice');
    }
    if (
      input.kind === 'choice' &&
      new Set(input.options.map((x) => JSON.stringify(x.value))).size !== input.options.length
    )
      throw new Error(`Duplicate choices for ${input.label}`);
  }
  for (const table of d.tables)
    if (new Set(table.rows.map((x) => JSON.stringify(x.key))).size !== table.rows.length)
      throw new Error(`Duplicate lookup key in ${table.key}`);
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const heights = new Map<string, number>();
  function visit(id: string, path: string[]): number {
    if (path.includes(id)) throw new Error(`Cyclic expression: ${id}`);
    if (path.length >= 32) throw new Error('Calculation depth exceeds 32');
    const cached = heights.get(id);
    if (cached !== undefined) {
      if (path.length + cached > 32) throw new Error('Calculation depth exceeds 32');
      return cached;
    }
    if (--budget.remaining < 0) throw new Error('Calculation validation limit exceeded');
    const n = nodes.get(id);
    if (!n) throw new Error(`Missing expression: ${id}`);
    let calledHeight = 0;
    if (n.op === 'call' && resolve) {
      const key = referenceKey(n.reference);
      if (stack.includes(key)) throw new Error(`Cyclic rule reference: ${n.reference.key}`);
      const target = resolve(n.reference);
      if (!target) throw new Error(`Unresolved rule: ${n.reference.key}`);
      if (!target.outputs.some((x) => x.key === n.output))
        throw new Error(`Unknown rule output: ${n.output}`);
      if (
        target.inputs.some((x) => !Object.hasOwn(n.arguments, x.key) && x.default === undefined) ||
        Object.keys(n.arguments).some((k) => !target.inputs.some((x) => x.key === k))
      )
        throw new Error(`Invalid argument bindings: ${n.reference.key}`);
      calledHeight = validateCalculation(target, resolve, [...stack, key], budget);
    }
    const height =
      1 + Math.max(calledHeight, ...nodeChildren(n).map((child) => visit(child, [...path, id])));
    if (path.length + height > 32) throw new Error('Calculation depth exceeds 32');
    heights.set(id, height);
    return height;
  }
  for (const node of d.nodes) {
    visit(node.id, []);
    if (node.op === 'input' && !d.inputs.some((x) => x.key === node.key))
      throw new Error(`Missing input: ${node.key}`);
    if (node.op === 'lookup' && !d.tables.some((x) => x.key === node.table))
      throw new Error(`Missing table: ${node.table}`);
  }
  for (const output of d.outputs) {
    if (output.min > output.max) throw new Error('Invalid output range');
    visit(output.node, []);
  }
  return Math.max(...heights.values());
}

export function evaluateCalculation(
  definition: CalculationDefinitionV1,
  inputs: CalculationInputs,
  resolve?: RuleResolver,
): Record<string, number> {
  validateCalculation(definition, resolve);
  let remaining = 10000;
  function run(
    d: CalculationDefinitionV1,
    supplied: Record<string, Value>,
    depth: number,
  ): Record<string, Decimal> {
    if (depth >= 32) throw new Error('Calculation depth exceeds 32');
    const inputValues = new Map<string, Value>();
    for (const key of Object.keys(supplied))
      if (!d.inputs.some((i) => i.key === key)) throw new Error(`Unknown input: ${key}`);
    for (const input of d.inputs) {
      const v = Object.hasOwn(supplied, input.key)
        ? supplied[input.key]
        : input.default === undefined
          ? undefined
          : value(input.default);
      if (v === undefined) throw new Error(`Choose ${input.label}`);
      if (input.kind === 'number') {
        const n = numeric(v);
        const min = Decimal.from(input.min);
        if (n.compare(min) < 0 || n.compare(Decimal.from(input.max)) > 0)
          throw new Error(`${input.label} is outside its range`);
        n.add(min.mul(new Decimal(-1n)))
          .div(Decimal.from(input.step))
          .round('exact');
      } else if (
        input.kind === 'boolean'
          ? typeof v !== 'boolean'
          : !input.options.some((o) => equal(value(o.value), v))
      )
        throw new Error(`Invalid choice for ${input.label}`);
      inputValues.set(input.key, v);
    }
    const nodes = new Map(d.nodes.map((n) => [n.id, n]));
    const memo = new Map<string, Value>();
    function evaluate(id: string): Value {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      if (--remaining < 0) throw new Error('Calculation operation limit exceeded');
      const n = nodes.get(id);
      if (!n) throw new Error(`Missing expression: ${id}`);
      let result: Value;
      if (n.op === 'constant') result = value(n.value);
      else if (n.op === 'input') {
        const v = inputValues.get(n.key);
        if (v === undefined) throw new Error(`Missing input: ${n.key}`);
        result = v;
      } else if ('args' in n) {
        const args = n.args.map((id) => numeric(evaluate(id)));
        result = args
          .slice(1)
          .reduce(
            (a, b) =>
              n.op === 'add'
                ? a.add(b)
                : n.op === 'multiply'
                  ? a.mul(b)
                  : n.op === 'min'
                    ? a.compare(b) <= 0
                      ? a
                      : b
                    : a.compare(b) >= 0
                      ? a
                      : b,
            args[0] as Decimal,
          );
      } else if ('left' in n) {
        const a = evaluate(n.left);
        const b = evaluate(n.right);
        result =
          n.op === 'eq'
            ? equal(a, b)
            : n.op === 'lt'
              ? numeric(a).compare(numeric(b)) < 0
              : n.op === 'lte'
                ? numeric(a).compare(numeric(b)) <= 0
                : n.op === 'divide'
                  ? numeric(a).div(numeric(b))
                  : numeric(a).add(numeric(b).mul(new Decimal(-1n)));
      } else if ('arg' in n) {
        const a = numeric(evaluate(n.arg));
        result =
          n.op === 'abs'
            ? new Decimal(a.n < 0n ? -a.n : a.n, a.d)
            : a.round(n.op === 'round' ? 'nearest' : n.op);
      } else if (n.op === 'if') {
        const condition = evaluate(n.condition);
        if (typeof condition !== 'boolean') throw new Error('Condition must be boolean');
        result = evaluate(condition ? n.then : n.else);
      } else if (n.op === 'lookup') {
        const key = evaluate(n.key);
        const row = d.tables
          .find((t) => t.key === n.table)
          ?.rows.find((r) => equal(value(r.key), key));
        if (!row) throw new Error(`No matching row in ${n.table}`);
        result = Decimal.from(row.value);
      } else {
        const target = resolve?.(n.reference);
        if (!target) throw new Error(`Unresolved rule: ${n.reference.key}`);
        const outputs = run(
          target,
          Object.fromEntries(Object.entries(n.arguments).map(([k, id]) => [k, evaluate(id)])),
          depth + 1,
        );
        const output = Object.hasOwn(outputs, n.output) ? outputs[n.output] : undefined;
        if (!output) throw new Error(`Unknown output: ${n.output}`);
        result = output;
      }
      memo.set(id, result);
      return result;
    }
    return Object.fromEntries(
      d.outputs.map((o) => {
        const increment = Decimal.from(o.increment);
        const result = numeric(evaluate(o.node)).div(increment).round(o.rounding).mul(increment);
        if (result.compare(Decimal.from(o.min)) < 0 || result.compare(Decimal.from(o.max)) > 0)
          throw new Error(`${o.key} is outside its allowed range`);
        return [o.key, result];
      }),
    );
  }
  return Object.fromEntries(
    Object.entries(
      run(definition, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, value(v)])), 0),
    ).map(([k, v]) => [k, v.number()]),
  );
}

function decimalIncrement(value: number): number {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  return Math.max(
    Number.MIN_VALUE,
    10 ** Math.min(0, Number(exponent) - (mantissa.split('.')[1]?.length ?? 0)),
  );
}
export function fixedCalculation(
  outputs: Record<string, { value: number; unit: 'points' | 'percentage' | 'currency' | 'pounds' }>,
): CalculationDefinitionV1 {
  return {
    version: 1,
    inputs: [],
    tables: [],
    nodes: Object.entries(outputs).map(([id, o]) => ({ id, op: 'constant', value: o.value })),
    outputs: Object.entries(outputs).map(([key, o]) => ({
      key,
      unit: o.unit,
      node: key,
      rounding: 'exact',
      increment:
        key === 'modifier'
          ? Math.min(0.01, decimalIncrement(o.value))
          : o.unit === 'points'
            ? 1
            : Math.min(0.01, decimalIncrement(o.value)),
      min:
        key === 'modifier'
          ? -200
          : o.unit === 'points'
            ? -1000
            : o.unit === 'percentage'
              ? -200
              : 0,
      max:
        key === 'modifier'
          ? 100000
          : o.unit === 'points'
            ? 1000
            : o.unit === 'pounds'
              ? 1_000_000
              : 100_000_000_000,
    })),
  };
}
export function legacyTraitCalculation(
  basePoints: number,
  pointsPerLevel?: number | null,
  maxLevel?: number | null,
): CalculationDefinitionV1 {
  const rule = fixedCalculation({ points: { value: basePoints, unit: 'points' } });
  if (pointsPerLevel != null) {
    rule.inputs.push({
      key: 'level',
      kind: 'number',
      label: 'Level',
      unit: 'level',
      min: 0,
      max: maxLevel ?? 99,
      step: 1,
      default: 1,
    });
    rule.nodes.push(
      { id: 'level', op: 'input', key: 'level' },
      { id: 'perLevel', op: 'constant', value: pointsPerLevel },
      { id: 'leveled', op: 'multiply', args: ['level', 'perLevel'] },
      { id: 'total', op: 'add', args: ['points', 'leveled'] },
    );
    if (rule.outputs[0]) rule.outputs[0].node = 'total';
  }
  return rule;
}
