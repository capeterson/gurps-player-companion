import { useState } from 'react';
import { parse, stringify } from 'yaml';
import { fixedCalculation, validateCalculation } from '../../../shared/domain/calculation.ts';
import {
  type CalculationDefinitionV1,
  calculationDefinition,
} from '../../../shared/schemas/calculation.ts';

import type { ReactNode } from 'react';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { type StructuredFieldProps, StructuredFields } from './StructuredFields.tsx';
import { newEditorId } from './editorId.ts';
import { libraryFormError } from './libraryFormErrors.ts';

export function CalculationEditor({
  value,
  onChange,
  onValidityChange,
  output = 'points',
  unit = 'points',
  defaultAmount = 0,
  defaultWeight = 0,
  allowBasic = true,
  renderField,
}: {
  value: CalculationDefinitionV1 | null | undefined;
  onChange: (rule: CalculationDefinitionV1 | null) => void;
  onValidityChange: (valid: boolean) => void;
  output?: string;
  defaultAmount?: number;
  defaultWeight?: number;
  allowBasic?: boolean;
  unit?: 'points' | 'percentage' | 'currency' | 'pounds';
  renderField?: ((props: StructuredFieldProps) => ReactNode | undefined) | undefined;
}) {
  const [text, setText] = useState(() => (value ? stringify(value) : ''));
  const [error, setError] = useState<string | null>(null);
  const [amountDraft, setAmount] = useState<string | null>(null);
  const amountOutput = value?.outputs?.find((entry) => entry.key === output);
  const amountNode = value?.nodes?.find((entry) => entry.id === amountOutput?.node);
  const amount =
    amountDraft ??
    String(
      amountNode?.op === 'constant' && typeof amountNode.value === 'number'
        ? amountNode.value
        : defaultAmount,
    );
  const [pattern, setPattern] = useState('fixed');
  const [minimum, setMinimum] = useState('0');
  const [maximum, setMaximum] = useState('99');
  const [step, setStep] = useState('1');
  const [inputUnit, setInputUnit] = useState<'level' | 'dice' | 'count' | 'divisor'>('level');
  const [options, setOptions] = useState([
    { editorId: newEditorId(), key: 'option-a', label: 'Option A', amount: '0' },
  ]);
  const [weightDraft, setWeight] = useState<string | null>(null);
  const weightOutput = value?.outputs?.find((entry) => entry.key === 'weightLbs');
  const weightNode = value?.nodes?.find((entry) => entry.id === weightOutput?.node);
  const weight =
    weightDraft ??
    String(
      weightNode?.op === 'constant' && typeof weightNode.value === 'number'
        ? weightNode.value
        : defaultWeight,
    );
  function accept(raw: string) {
    setText(raw);
    try {
      const rule = raw.trim() ? calculationDefinition.parse(parse(raw)) : null;
      if (rule) validateCalculation(rule);
      onChange(rule);
      onValidityChange(true);
      setError(null);
    } catch (e) {
      setError(libraryFormError(e));
      onValidityChange(false);
    }
  }
  function preset() {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n)) {
      setError('Enter a finite amount before using this pattern.');
      return;
    }
    const min = Number(minimum);
    const max = Number(maximum);
    const increment = Number(step);
    if (
      (pattern === 'per-unit' || pattern === 'range') &&
      (!minimum.trim() ||
        !maximum.trim() ||
        !step.trim() ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(increment) ||
        min > max ||
        increment <= 0)
    ) {
      setError('Enter a minimum no greater than the maximum and a positive step.');
      return;
    }
    if (
      output === 'cost' &&
      (!weight.trim() || !Number.isFinite(Number(weight)) || Number(weight) < 0)
    ) {
      setError('Enter a nonnegative fixed weight for the preset.');
      return;
    }
    if (
      (pattern === 'choice' || pattern === 'table') &&
      options.some((option) => !option.amount.trim() || !Number.isFinite(Number(option.amount)))
    ) {
      setError('Each lookup row needs a finite amount.');
      return;
    }
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
      const fixedWeight = fixedCalculation({
        weightLbs: { value: Number(weight), unit: 'pounds' },
      });
      rule.nodes.push(...fixedWeight.nodes);
      rule.outputs.push(...fixedWeight.outputs);
    }
    try {
      validateCalculation(calculationDefinition.parse(rule));
      accept(stringify(rule));
    } catch (e) {
      setError(libraryFormError(e));
    }
  }
  return (
    <LibraryAdvancedFields
      title={value ? 'Calculated pricing · rule configured' : 'Calculated pricing (optional)'}
      defaultOpen={Boolean(value)}
      error={error}
      hint={
        allowBasic
          ? 'Use this for choices, levels or variable prices. Leave it empty to use the basic price fields. Pattern fields are a draft until you choose Use pattern.'
          : 'Choose a pattern and enter the amount, then choose Use pattern to apply it.'
      }
    >
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
              <div
                key={option.editorId}
                className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                {(['key', 'label', 'amount'] as const).map((field) => (
                  <label key={field}>
                    {field}
                    <input
                      className="input input-sm w-full"
                      aria-label={`Lookup row ${index + 1} ${field}`}
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
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={options.length === 1}
                  aria-label={`Remove lookup row ${index + 1}`}
                  onClick={() => setOptions(options.filter((_, rowIndex) => rowIndex !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm w-fit"
              onClick={() =>
                setOptions([
                  ...options,
                  {
                    editorId: newEditorId(),
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
        {value && (
          <StructuredFields
            schema={calculationDefinition}
            value={value}
            label="Calculation definition"
            path="calculation"
            renderField={renderField}
            onChange={(next) => {
              setText(stringify(next));
              onChange(next as CalculationDefinitionV1);
              try {
                validateCalculation(calculationDefinition.parse(next));
                setError(null);
                onValidityChange(true);
              } catch (cause) {
                setError(libraryFormError(cause));
                onValidityChange(false);
              }
            }}
          />
        )}
        {value && (
          <p className="text-sm break-words">
            {value.inputs.length} inputs · {value.tables.length} tables · Outputs:{' '}
            {value.outputs.map((o) => `${o.key} (${o.unit})`).join(', ')}
          </p>
        )}
        {(value || text) && (
          <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => accept('')}>
            {allowBasic ? 'Use basic price fields' : 'Remove calculation'}
          </button>
        )}
        {error && (
          <p role="alert" className="text-error whitespace-pre-wrap break-words">
            {error}
          </p>
        )}
      </fieldset>
    </LibraryAdvancedFields>
  );
}
