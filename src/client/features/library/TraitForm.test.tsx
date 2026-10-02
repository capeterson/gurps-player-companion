import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraitForm } from './TraitForm.tsx';

describe('TraitForm shared authoring', () => {
  it('keeps invalid whole-entry YAML and submits the corrected calculation definition', () => {
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
    const editor = screen.getByLabelText('Raw YAML');
    const invalidYaml = 'name: [unfinished\n';
    fireEvent.change(editor, { target: { value: invalidYaml } });

    expect(screen.getByLabelText('Raw YAML')).toHaveValue(invalidYaml);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add trait' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    const validYaml = `name: Flexible trait
kind: advantage
basePoints: 1
availableModifiers:
  - name: Calculated
    category: enhancement
    costType: flat
    costValue: 0
    calculation:
      version: 1
      inputs: []
      tables: []
      nodes:
        - id: value
          op: constant
          value: 0.001
      outputs:
        - key: points
          node: value
          unit: points
          min: -100
          max: 100
          increment: 0.001
          rounding: exact
`;
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
