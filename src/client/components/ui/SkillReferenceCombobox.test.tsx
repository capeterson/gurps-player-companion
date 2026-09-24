import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SkillReferenceCombobox,
  type SkillReferenceOption,
  skillReferenceOptions,
} from './SkillReferenceCombobox.tsx';

describe('skillReferenceOptions', () => {
  it('prefers campaign definitions over character rows for normalized conflicts', () => {
    expect(
      skillReferenceOptions(
        [{ name: 'guns', specialization: ' pistol ' }],
        [{ name: 'Guns', defaultSpecialization: 'Pistol', specializationPolicy: { kind: 'none' } }],
      ),
    ).toEqual([{ label: 'Guns/Pistol', source: 'campaign' }]);
  });
});

function renderCombobox(
  overrides: Partial<{
    value: string;
    onChange: (value: string) => void;
    onPick: (option: SkillReferenceOption) => void;
  }> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const onPick = overrides.onPick ?? vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SkillReferenceCombobox
        aria-label="Skill reference"
        value={overrides.value ?? ''}
        onChange={onChange}
        onPick={onPick}
        campaignSkills={[
          {
            name: 'Guns',
            defaultSpecialization: 'Pistol',
            specializationPolicy: {
              kind: 'required_catalog',
              options: [{ name: 'Pistol' }, { name: 'Carbine' }],
            },
          },
        ]}
        characterSkills={[
          { name: 'Stealth', specialization: null },
          { name: 'Guns', specialization: 'Rifle' },
        ]}
      />
    </QueryClientProvider>,
  );
  return { onChange, onPick };
}

describe('SkillReferenceCombobox', () => {
  it('shows campaign and character suggestions together', async () => {
    renderCombobox();
    const input = screen.getByRole('combobox', { name: 'Skill reference' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(await screen.findByText('Guns/Pistol')).toBeVisible();
    expect(screen.getByText('Guns/Rifle')).toBeVisible();
    expect(screen.getByText('Stealth')).toBeVisible();
  });

  it('retains free text through onChange when no suggestion is selected', () => {
    const onChange = vi.fn();
    renderCombobox({ onChange });
    const input = screen.getByRole('combobox', { name: 'Skill reference' });
    fireEvent.change(input, { target: { value: 'Unlisted skill' } });
    expect(onChange).toHaveBeenLastCalledWith('Unlisted skill');
  });

  it('selects the highlighted suggestion from the keyboard', async () => {
    const onPick = vi.fn();
    renderCombobox({ onPick });
    const input = screen.getByRole('combobox', { name: 'Skill reference' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await screen.findByText('Guns/Pistol');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
    expect(onPick).toHaveBeenCalledWith({ label: 'Guns/Pistol', source: 'campaign' });
  });
});
