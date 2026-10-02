import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { skillPrerequisite } from '../../../shared/schemas/skillRules.ts';
import { StructuredFields } from './StructuredFields.tsx';

const importedPrerequisite = {
  kind: 'all',
  children: [
    { kind: 'attribute', attribute: 'IQ', minimum: 11 },
    {
      kind: 'any',
      children: [
        { kind: 'skill', name: 'Sword', minimumPoints: 4 },
        { kind: 'campaign_rule', ruleKey: 'allow_magic', expectedValue: true },
      ],
    },
  ],
} as const;

function PrerequisiteHarness() {
  const [value, setValue] = useState(importedPrerequisite);
  return (
    <>
      <StructuredFields
        schema={skillPrerequisite}
        value={value}
        label="Prerequisite rules"
        onChange={setValue as (next: unknown) => void}
      />
      <output aria-label="Prerequisite JSON">{JSON.stringify(value)}</output>
    </>
  );
}

describe('StructuredFields recursive schema branches', () => {
  it('renders and edits nested all/any prerequisite unions without dropping their children', () => {
    render(<PrerequisiteHarness />);
    expect(screen.getAllByLabelText('Requirements 1 type').length).toBeGreaterThan(0);
    const minimum = screen.getByLabelText('Minimum');
    fireEvent.change(minimum, { target: { value: '12' } });
    const saved = JSON.parse(screen.getByLabelText('Prerequisite JSON').textContent ?? 'null');
    expect(saved).toEqual({
      kind: 'all',
      children: [
        { kind: 'attribute', attribute: 'IQ', minimum: 12 },
        {
          kind: 'any',
          children: [
            { kind: 'skill', name: 'Sword', minimumPoints: 4 },
            { kind: 'campaign_rule', ruleKey: 'allow_magic', expectedValue: true },
          ],
        },
      ],
    });
    expect(screen.getByLabelText('Rule Key')).toHaveValue('allow_magic');
  });

  it('preserves imported calculation operation branches and supports boolean, text, and number values', () => {
    const schema = z.object({
      name: z.string(),
      value: z.union([z.boolean(), z.string(), z.number()]),
      operation: z.discriminatedUnion('op', [
        z.object({
          op: z.literal('constant'),
          id: z.string(),
          value: z.union([z.number(), z.string(), z.boolean()]),
        }),
        z.object({ op: z.literal('input'), id: z.string(), key: z.string() }),
        z.object({ op: z.literal('add'), id: z.string(), args: z.array(z.string()) }),
        z.object({ op: z.literal('lookup'), id: z.string(), table: z.string(), key: z.string() }),
      ]),
    });
    const initial = {
      name: 'Imported pricing',
      value: true,
      operation: { op: 'lookup' as const, id: 'lookup', table: 'size', key: 'size_modifier' },
    };
    function Harness() {
      const [value, setValue] = useState(initial);
      return (
        <>
          <StructuredFields
            schema={schema}
            value={value}
            label="Definition"
            onChange={setValue as (next: unknown) => void}
          />
          <output aria-label="Structured JSON">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByDisplayValue('Imported pricing'), {
      target: { value: 'Updated pricing' },
    });
    let saved = JSON.parse(screen.getByLabelText('Structured JSON').textContent ?? 'null');
    expect(saved).toMatchObject({
      name: 'Updated pricing',
      value: true,
      operation: { op: 'lookup', id: 'lookup', table: 'size', key: 'size_modifier' },
    });

    const type = screen.getByLabelText('Value type');
    fireEvent.change(type, { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'calculated' } });
    saved = JSON.parse(screen.getByLabelText('Structured JSON').textContent ?? 'null');
    expect(saved.value).toBe('calculated');
    fireEvent.change(type, { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '7' } });
    saved = JSON.parse(screen.getByLabelText('Structured JSON').textContent ?? 'null');
    expect(saved.value).toBe(7);
    expect(saved.operation).toEqual({
      op: 'lookup',
      id: 'lookup',
      table: 'size',
      key: 'size_modifier',
    });
  });

  it('opens a nullable recursive prerequisite union and keeps blank numeric drafts empty', () => {
    const schema = z.object({ prerequisiteRules: skillPrerequisite.nullable().optional() });
    function Harness() {
      const [value, setValue] = useState<{ prerequisiteRules?: unknown }>({
        prerequisiteRules: null,
      });
      return (
        <>
          <StructuredFields
            schema={schema}
            value={value}
            label="Rules"
            onChange={setValue as (next: unknown) => void}
          />
          <output aria-label="Nullable prerequisite JSON">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Prerequisite rules setting'), {
      target: { value: 'value' },
    });
    const kind = screen.getByLabelText('Prerequisite rules type');
    const allChoice = Array.from(kind.querySelectorAll('option')).find(
      (option) => option.textContent === 'All of these',
    );
    expect(allChoice).toBeDefined();
    fireEvent.change(kind, { target: { value: allChoice?.value } });
    const childKind = screen.getByLabelText('Requirements 1 type');
    const attributeChoice = Array.from(childKind.querySelectorAll('option')).find(
      (option) => option.textContent === 'Attribute',
    );
    fireEvent.change(childKind, { target: { value: attributeChoice?.value } });
    const minimum = screen.getByLabelText('Minimum');
    fireEvent.change(minimum, { target: { value: '' } });
    expect(minimum).toHaveValue('');
    const stored = JSON.parse(
      screen.getByLabelText('Nullable prerequisite JSON').textContent ?? '{}',
    );
    expect(stored.prerequisiteRules).toMatchObject({
      kind: 'all',
      children: [expect.objectContaining({ kind: 'attribute', minimum: '' })],
    });
    expect(screen.getByLabelText('Nullable prerequisite JSON')).not.toHaveTextContent('null');
  });

  it('keeps incomplete shared fields and cached branch fields while changing union types', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('all'), name: z.string().min(1), leftValue: z.string() }),
      z.object({ kind: z.literal('any'), name: z.string().min(1), rightValue: z.string() }),
    ]);
    function Harness() {
      const [value, setValue] = useState({
        kind: 'all' as const,
        name: 'Initial name',
        leftValue: 'retained left branch',
      });
      return (
        <>
          <StructuredFields
            schema={schema}
            value={value}
            label="Definition"
            onChange={setValue as (next: unknown) => void}
          />
          <output aria-label="Choice JSON">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    const type = screen.getByLabelText('Definition type');
    const anyChoice = Array.from(type.querySelectorAll('option')).find(
      (option) => option.textContent === 'Any of these',
    );
    fireEvent.change(type, { target: { value: anyChoice?.value } });
    expect(screen.getByLabelText('Name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated name' } });
    fireEvent.change(screen.getByLabelText('Right Value'), { target: { value: 'right branch' } });
    fireEvent.change(type, { target: { value: '0' } });

    expect(screen.getByLabelText('Name')).toHaveValue('Updated name');
    expect(screen.getByLabelText('Left Value')).toHaveValue('retained left branch');
    const stored = JSON.parse(screen.getByLabelText('Choice JSON').textContent ?? '{}');
    expect(stored).toEqual({
      kind: 'all',
      name: 'Updated name',
      leftValue: 'retained left branch',
    });
  });

  it('retains fractional and negative numeric drafts until they parse or blur', () => {
    const schema = z.object({ weight: z.number() });
    function Harness() {
      const [value, setValue] = useState({ weight: 1 });
      return (
        <>
          <StructuredFields
            schema={schema}
            value={value}
            label="Definition"
            onChange={setValue as (next: unknown) => void}
          />
          <output aria-label="Weight JSON">{JSON.stringify(value)}</output>
        </>
      );
    }

    render(<Harness />);
    const weight = screen.getByLabelText('Weight') as HTMLInputElement;
    weight.focus();
    expect(document.activeElement).toBe(weight);
    fireEvent.change(weight, { target: { value: '1' } });
    expect(weight).toHaveValue('1');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":1}');

    fireEvent.change(weight, { target: { value: '1.' } });
    expect(weight).toHaveValue('1.');
    expect(document.activeElement).toBe(weight);
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":"1."}');
    fireEvent.change(weight, { target: { value: '1.5' } });
    expect(weight).toHaveValue('1.5');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":1.5}');

    fireEvent.change(weight, { target: { value: '' } });
    fireEvent.change(weight, { target: { value: '-' } });
    expect(weight).toHaveValue('-');
    expect(document.activeElement).toBe(weight);
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":"-"}');
    fireEvent.change(weight, { target: { value: '-0' } });
    expect(weight).toHaveValue('-0');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":"-0"}');
    fireEvent.change(weight, { target: { value: '-0.' } });
    expect(weight).toHaveValue('-0.');
    expect(document.activeElement).toBe(weight);
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":"-0."}');
    fireEvent.change(weight, { target: { value: '-0.5' } });
    expect(weight).toHaveValue('-0.5');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":-0.5}');

    fireEvent.change(weight, { target: { value: '1.' } });
    fireEvent.blur(weight);
    expect(weight).toHaveValue('1');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":1}');
    fireEvent.change(weight, { target: { value: '-0' } });
    fireEvent.blur(weight);
    expect(weight).toHaveValue('0');
    expect(screen.getByLabelText('Weight JSON')).toHaveTextContent('{"weight":0}');
  });
});
