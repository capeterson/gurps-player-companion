import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraitForm } from './TraitForm.tsx';

vi.mock('../../components/markdown/RichTextEditor.tsx', () => ({
  RichTextEditor: (props: {
    value: string;
    onChange: (value: string) => void;
    'aria-label': string;
  }) => (
    <textarea
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

describe('TraitForm modifier source', () => {
  it('retains invalid YAML, blocks saving, then saves a corrected calculation rule', () => {
    const onSubmit = vi.fn();
    render(
      <TraitForm
        campaignId={null}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        libraryItems={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Flexible trait' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit modifier YAML' }));
    const editor = screen.getByLabelText('Modifier definitions (YAML)');
    const invalidYaml = '- name: Incomplete\n  category: enhancement\n';
    fireEvent.change(editor, { target: { value: invalidYaml } });

    expect(screen.getByLabelText('Modifier definitions (YAML)')).toHaveValue(invalidYaml);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add trait' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    const validYaml =
      '- name: Calculated\n  category: enhancement\n  costType: flat\n  costValue: 0\n  calculation:\n    version: 1\n    inputs: []\n    tables: []\n    nodes:\n      - id: value\n        op: constant\n        value: 0.001\n    outputs:\n      - key: points\n        node: value\n        unit: points\n        min: -100\n        max: 100\n        increment: 0.001\n        rounding: exact\n';
    fireEvent.change(editor, { target: { value: validYaml } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add trait' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add trait' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Flexible trait',
        availableModifiers: [
          expect.objectContaining({
            name: 'Calculated',
            costValue: 0,
            calculation: expect.objectContaining({ version: 1 }),
          }),
        ],
      }),
    );
  });
});
