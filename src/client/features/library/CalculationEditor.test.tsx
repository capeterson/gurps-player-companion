import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixedCalculation } from '../../../shared/domain/calculation.ts';
import type { CalculationDefinitionV1 } from '../../../shared/schemas/calculation.ts';
import { CalculationEditor } from './CalculationEditor.tsx';

describe('CalculationEditor guided patterns', () => {
  it('carries existing fixed cost and weight into a new preset', () => {
    const onChange = vi.fn<(rule: CalculationDefinitionV1 | null) => void>();
    const value = fixedCalculation({
      cost: { value: 12, unit: 'currency' },
      weightLbs: { value: 2.5, unit: 'pounds' },
    });
    render(
      <CalculationEditor
        value={value}
        onChange={onChange}
        onValidityChange={vi.fn()}
        output="cost"
        unit="currency"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use pattern' }));

    const next = onChange.mock.calls[0]?.[0];
    expect(next?.nodes.find((node) => node.id === 'cost')).toMatchObject({
      op: 'constant',
      value: 12,
    });
    expect(next?.nodes.find((node) => node.id === 'weightLbs')).toMatchObject({
      op: 'constant',
      value: 2.5,
    });
  });

  it('keeps blank numeric bounds invalid until corrected', async () => {
    const onChange = vi.fn<(rule: CalculationDefinitionV1 | null) => void>();
    const onValidityChange = vi.fn();
    render(
      <CalculationEditor value={null} onChange={onChange} onValidityChange={onValidityChange} />,
    );
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use pattern' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/minimum no greater than the maximum/i);
    expect(onValidityChange).not.toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();

    const disclosure = screen.getByText('Calculated pricing (optional)');
    fireEvent.click(disclosure);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('Minimum')).toHaveValue('');
  });

  it('returns to basic fields on explicit reset', () => {
    const onChange = vi.fn<(rule: CalculationDefinitionV1 | null) => void>();
    const value = fixedCalculation({ cost: { value: 12, unit: 'currency' } });
    render(
      <CalculationEditor
        value={value}
        onChange={onChange}
        onValidityChange={vi.fn()}
        output="cost"
        unit="currency"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use basic price fields' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
