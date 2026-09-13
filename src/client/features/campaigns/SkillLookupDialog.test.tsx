import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { SkillLookupDialog } from './SkillLookupDialog.tsx';
import { resolveSkillLookup } from './skillLookup.ts';

const character = {
  skills: [
    { name: 'Guns', specialization: 'Pistol', level: 12, effectiveLevel: 14 },
    { name: 'Guns', specialization: 'Rifle', level: 10, effectiveLevel: 10 },
    { name: 'Guns', specialization: 'Musket', level: null, effectiveLevel: null },
  ],
} as CharacterDetail;

describe('GM specialty lookup', () => {
  it('keeps specialties selectable and resolves the selected effective level', async () => {
    const onSelect = vi.fn();
    render(
      <SkillLookupDialog
        open
        characters={[character, character]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Search skills or stats'), {
      target: { value: 'Guns' },
    });
    expect(await screen.findByRole('option', { name: 'Guns/Pistol' })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Guns/Rifle' }));
    expect(onSelect).toHaveBeenCalledWith('Guns/Rifle');
    expect(resolveSkillLookup(character, onSelect.mock.calls[0]?.[0])).toEqual({
      label: 'Guns/Rifle',
      level: 10,
    });
    expect(resolveSkillLookup(character, 'guns (pistol)')).toEqual({
      label: 'Guns/Pistol',
      level: 14,
    });
  });

  it('does not silently choose a specialty for an ambiguous or unavailable name', () => {
    expect(resolveSkillLookup(character, 'Guns')).toBeNull();
    expect(resolveSkillLookup(character, 'Guns (Shotgun)')).toBeNull();
    expect(resolveSkillLookup(character, 'Guns (Musket)')).toEqual({
      label: 'Guns/Musket',
      level: null,
    });
  });
});
