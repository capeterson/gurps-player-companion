import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { skillAction, skillModifierRule } from '../../../../shared/schemas/skillProcedures.ts';
import { RollSheet } from './RollSheet.tsx';
import { ProseActionPreview, SkillRulePreview } from './SkillRulePreview.tsx';
afterEach(cleanup);
it('keeps the base target separate, prompts for unknown context, and labels selected range modifiers', () => {
  const rules = [
    skillModifierRule.parse({
      id: 'terrain',
      label: 'Bad terrain',
      when: [
        {
          input: { domain: 'environment', key: 'underwater', label: 'Underwater' },
          operator: 'equals',
          value: true,
        },
      ],
      value: { kind: 'fixed', value: -3 },
      appliesTo: 'task_roll',
      sourceText: 'Source B test',
    }),
    skillModifierRule.parse({
      id: 'tools',
      label: 'Tools',
      value: { kind: 'range', minimum: -4, maximum: 2 },
      appliesTo: 'task_roll',
    }),
  ];
  render(
    <RollSheet
      characterId="test"
      request={{ label: 'Swimming', baseTarget: 14, rules }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText('Effective target 14')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Underwater'), { target: { value: 'true' } });
  expect(screen.getByLabelText('Effective target 11')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tools value'), { target: { value: '-2' } });
  expect(screen.getByLabelText('Effective target 9')).toBeInTheDocument();
  expect(screen.getAllByText(/Player\/GM choice/)).toHaveLength(2);
  expect(screen.getByText(/Source B test/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Underwater'), { target: { value: '' } });
  expect(screen.getByLabelText('Effective target 12')).toBeInTheDocument();
});

it('keeps irrelevant scaling inputs hidden and shows them once the prerequisite is selected', () => {
  const rule = skillModifierRule.parse({
    id: 'r',
    label: 'Moving terrain',
    appliesTo: 'task_roll',
    when: [
      {
        input: { domain: 'movement', key: 'moving', label: 'Moving' },
        operator: 'equals',
        value: true,
      },
    ],
    value: {
      kind: 'table',
      input: { domain: 'environment', key: 'terrain', label: 'Terrain grade' },
      rows: [{ minimum: 0, maximum: 3, value: -2 }],
    },
  });
  function Preview() {
    const [context, setContext] = useState<Record<string, boolean | string | number>>({});
    return (
      <SkillRulePreview
        rules={[rule]}
        source="Movement"
        context={context}
        choices={{}}
        onContext={setContext}
        onChoices={() => {}}
      />
    );
  }
  render(<Preview />);
  expect(screen.queryByLabelText('Terrain grade')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Moving'), { target: { value: 'true' } });
  expect(screen.getByLabelText('Terrain grade')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Moving'), { target: { value: 'false' } });
  expect(screen.queryByLabelText('Terrain grade')).not.toBeInTheDocument();
});
it('shows prose action details and recalculates known inputs when the sheet changes', () => {
  const action = skillAction.parse({
    id: 'prose',
    label: 'Rest',
    roll: { basis: 'prose_only' },
    time: {
      amount: { kind: 'input', input: { domain: 'character', key: 'HT', label: 'HT' } },
      unit: 'minutes',
    },
    outcomes: [{ on: 'success', kind: 'note', text: 'GM adjudicates' }],
  });
  const view = render(
    <ProseActionPreview action={action} source="Recovery" context={{ 'character:HT': 10 }} />,
  );
  fireEvent.click(screen.getByText('Procedure details'));
  expect(screen.getByText('Time: 10 minutes')).toBeInTheDocument();
  view.rerender(
    <ProseActionPreview action={action} source="Recovery" context={{ 'character:HT': 12 }} />,
  );
  expect(screen.getByText('Time: 12 minutes')).toBeInTheDocument();
  expect(screen.queryByText('Roll 3d6')).not.toBeInTheDocument();
});
