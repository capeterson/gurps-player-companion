import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Puissance' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add effect' }));
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'weapon_damage' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: '+ Add level' }));
    const level = screen.getByRole('group', { name: 'Level 1' });
    fireEvent.click(within(level).getByRole('button', { name: '+ Effect' }));
    fireEvent.change(within(level).getByLabelText('Target'), { target: { value: 'skill' } });
    // Switching to a skill target defaults the skill to every skill.
    expect(within(level).getByRole('combobox', { name: 'Skill' })).toHaveValue('*');
    fireEvent.change(within(level).getByLabelText('Value'), { target: { value: '-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add enchantment' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Puissance',
        effects: [{ target: 'weapon_damage', value: 2 }],
        levels: [{ level: 1, effects: [{ target: 'skill', value: -1, skillName: '*' }] }],
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
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0] as HTMLElement);
    expect(screen.getAllByLabelText('Value')).toHaveLength(1);
    expect(screen.getByLabelText('Value')).toHaveValue(2);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ effects: [{ target: 'db', value: 2 }] }),
    );
  });
});
