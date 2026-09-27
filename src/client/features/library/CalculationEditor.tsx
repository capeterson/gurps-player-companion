import { useState } from 'react';
import { parse, stringify } from 'yaml';
import {
  fixedCalculation,
  legacyTraitCalculation,
  validateCalculation,
} from '../../../shared/domain/calculation.ts';
import {
  type CalculationDefinitionV1,
  calculationDefinition,
} from '../../../shared/schemas/calculation.ts';

export function CalculationEditor({
  value,
  onChange,
  onValidityChange,
  output = 'points',
  unit = 'points',
}: {
  value: CalculationDefinitionV1 | null | undefined;
  onChange: (rule: CalculationDefinitionV1 | null) => void;
  onValidityChange: (valid: boolean) => void;
  output?: string;
  unit?: 'points' | 'percentage' | 'currency' | 'pounds';
}) {
  const [text, setText] = useState(() => (value ? stringify(value) : ''));
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('0');
  const [pattern, setPattern] = useState('fixed');
  const [minimum, setMinimum] = useState('0');
  const [maximum, setMaximum] = useState('99');
  const [step, setStep] = useState('1');
  const [inputUnit, setInputUnit] = useState<'level' | 'dice' | 'count' | 'divisor'>('level');
  const [options, setOptions] = useState([
    { editorId: crypto.randomUUID(), key: 'option-a', label: 'Option A', amount: '0' },
  ]);
  const [weight, setWeight] = useState('0');
  function accept(raw: string) {
    setText(raw);
    try {
      const rule = raw.trim() ? calculationDefinition.parse(parse(raw)) : null;
      if (rule) validateCalculation(rule);
      onChange(rule);
      onValidityChange(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      onValidityChange(false);
    }
  }
  function preset() {
    const n = Number(amount);
    if (!Number.isFinite(n)) {
      setError('Amount must be finite');
      return;
    }
    const min = Number(minimum);
    const max = Number(maximum);
    const increment = Number(step);
    const rule = fixedCalculation({ [output]: { value: n, unit } });
    if (pattern === 'per-unit') {
      rule.inputs = [
        {
          key: inputUnit,
          kind: 'number',
          label: inputUnit,
          unit: inputUnit,
          min,
          max,
          step: increment,
        },
      ];
      rule.nodes.push(
        { id: 'units', op: 'input', key: inputUnit },
        { id: 'total', op: 'multiply', args: [output, 'units'] },
      );
      if (rule.outputs[0]) rule.outputs[0].node = 'total';
    } else if (pattern === 'range') {
      rule.inputs = [
        { key: 'value', kind: 'number', label: 'Value', unit, min, max, step: increment },
      ];
      rule.nodes = [{ id: output, op: 'input', key: 'value' }];
    } else if (pattern === 'choice' || pattern === 'table') {
      rule.inputs = [
        {
          key: 'option',
          label: 'Option',
          kind: 'choice',
          options: options.map((o) => ({ label: o.label, value: o.key })),
        },
      ];
      rule.tables = [
        { key: 'options', rows: options.map((o) => ({ key: o.key, value: Number(o.amount) })) },
      ];
      rule.nodes = [
        { id: 'option', op: 'input', key: 'option' },
        { id: output, op: 'lookup', table: 'options', key: 'option' },
      ];
    }
    if (output === 'cost') {
      const previousWeight = value?.outputs.find((o) => o.key === 'weightLbs');
      const fixedWeight = fixedCalculation({
        weightLbs: { value: Number(weight), unit: 'pounds' },
      });
      if (previousWeight && value && weight === '') {
        // A preset replaces the whole rule; preserve a constant weight when possible.
        const node = value.nodes.find((n) => n.id === previousWeight.node && n.op === 'constant');
        if (node && node.op === 'constant' && typeof node.value === 'number')
          fixedWeight.nodes = [{ id: 'weightLbs', op: 'constant', value: node.value }];
      }
      rule.nodes.push(...fixedWeight.nodes);
      rule.outputs.push(...fixedWeight.outputs);
    }
    try {
      validateCalculation(calculationDefinition.parse(rule));
      accept(stringify(rule));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <fieldset className="fieldset min-w-0">
      <legend className="fieldset-legend">Calculation rule</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          Pattern
          <select
            className="select select-sm"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          >
            <option value="fixed">Fixed</option>
            <option value="per-unit">Per unit</option>
            <option value="range">Bounded range</option>
            <option value="choice">Choice</option>
            <option value="table">Table</option>
          </select>
        </label>
        <label>
          Amount
          <input
            className="input input-sm w-28"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-sm" onClick={preset}>
          Use pattern
        </button>
      </div>
      {(pattern === 'per-unit' || pattern === 'range') && (
        <div className="flex flex-wrap gap-2">
          {pattern === 'per-unit' && (
            <label>
              Input unit
              <select
                className="select select-sm"
                value={inputUnit}
                onChange={(e) => setInputUnit(e.target.value as typeof inputUnit)}
              >
                {['level', 'dice', 'count', 'divisor'].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Minimum
            <input
              className="input input-sm w-24"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </label>
          <label>
            Maximum
            <input
              className="input input-sm w-24"
              value={maximum}
              onChange={(e) => setMaximum(e.target.value)}
            />
          </label>
          <label>
            Step
            <input
              className="input input-sm w-24"
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </label>
        </div>
      )}
      {(pattern === 'choice' || pattern === 'table') && (
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Lookup rows</legend>
          {options.map((option, index) => (
            <div key={option.editorId} className="grid gap-2 sm:grid-cols-3">
              {(['key', 'label', 'amount'] as const).map((field) => (
                <label key={field}>
                  {field}
                  <input
                    className="input input-sm w-full"
                    value={option[field]}
                    onChange={(e) =>
                      setOptions(
                        options.map((o, i) =>
                          index === i ? { ...o, [field]: e.target.value } : o,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm w-fit"
            onClick={() =>
              setOptions([
                ...options,
                {
                  editorId: crypto.randomUUID(),
                  key: `option-${options.length + 1}`,
                  label: 'New option',
                  amount: '0',
                },
              ])
            }
          >
            Add lookup row
          </button>
        </fieldset>
      )}
      {output === 'cost' && (
        <label>
          Fixed weight for preset (lb)
          <input
            className="input input-sm w-28"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
      )}
      <p className="text-xs">
        Use pattern replaces the rule. Advanced rules remain editable below; no book values are
        supplied.
      </p>
      <label>
        Advanced rule (YAML)
        <textarea
          className="textarea w-full font-mono text-xs"
          rows={12}
          value={text}
          onChange={(e) => accept(e.target.value)}
          spellCheck={false}
        />
      </label>
      {value && (
        <p className="text-sm break-words">
          {value.inputs.length} inputs · {value.tables.length} tables · Outputs:{' '}
          {value.outputs.map((o) => `${o.key} (${o.unit})`).join(', ')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-error whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
    </fieldset>
  );
}
