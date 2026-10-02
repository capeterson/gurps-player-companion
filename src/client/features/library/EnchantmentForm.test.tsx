import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryEnchantmentOut } from '../../../shared/schemas/campaignLibrary.ts';
import { EnchantmentForm } from './EnchantmentForm.tsx';

function renderForm(initial?: LibraryEnchantmentOut) {
  const onSubmit = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EnchantmentForm
        campaignId={null}
        {...(initial ? { initial } : {})}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

describe('EnchantmentForm effect rows', () => {
  it('edits base and level effects with the same row controls', () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Puissance' } });

    fireEvent.click(screen.getByText('Effects and capabilities', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add effects' }));
    fireEvent.change(screen.getAllByLabelText('Target')[0] as HTMLElement, {
      target: { value: 'weapon_damage' },
    });
    fireEvent.change(screen.getAllByLabelText('Value')[0] as HTMLElement, {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add levels' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add effects' })[1] as HTMLElement);
    const targets = screen.getAllByLabelText('Target');
    const values = screen.getAllByLabelText('Value');
    fireEvent.change(targets[1] as HTMLElement, { target: { value: 'dr' } });
    fireEvent.change(values[1] as HTMLElement, { target: { value: '-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add enchantment' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Puissance',
        effects: [{ target: 'weapon_damage', value: 2 }],
        levels: [{ level: 1, effects: [{ target: 'dr', value: -1 }] }],
      }),
    );
  });

  it('removes only the chosen effect row', () => {
    const { onSubmit } = renderForm({
      id: '00000000-0000-7000-8000-000000000001',
      campaignId: '00000000-0000-7000-8000-000000000002',
      name: 'Fortify',
      description: null,
      source: null,
      tags: [],
      applicability: 'armor',
      effects: [
        { target: 'dr', value: 1 },
        { target: 'db', value: 2 },
      ],
      levels: [],
      stackingPolicy: { kind: 'stack' },
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as LibraryEnchantmentOut);
    const removeButtons = screen.getAllByRole('button', { name: /^Remove Effects/ });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0] as HTMLElement);
    expect(screen.getAllByLabelText('Value')).toHaveLength(1);
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ effects: [{ target: 'db', value: 2 }] }),
    );
  });
});
