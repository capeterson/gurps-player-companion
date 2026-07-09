/**
 * SkillsCard — usable (non-null-level) skills render sorted by level
 * desc then name, and tapping a row opens the roll sheet at that
 * skill's computed level.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { SkillsCard } from './SkillsCard.tsx';

function makeCharacter(): CharacterDetail {
  return {
    id: 'char-1',
    skills: [
      { id: 's1', name: 'Axe/Mace', level: 12 },
      { id: 's2', name: 'Broadsword', level: 15 },
      { id: 's3', name: 'Unusable (VH, 0 pts)', level: null },
    ],
    spells: [],
    manaLevel: 'normal',
    combat: null,
    derived: { hp: 10, fp: 10 },
    inventory: [],
  } as unknown as CharacterDetail;
}

describe('SkillsCard', () => {
  it('renders usable skills sorted by level desc, omitting null-level skills', () => {
    render(<SkillsCard character={makeCharacter()} canWrite={true} openRoll={vi.fn()} />);

    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Broadsword');
    expect(rows[1]).toHaveTextContent('Axe/Mace');
    expect(screen.queryByText(/Unusable/)).not.toBeInTheDocument();
  });

  it('tapping a skill row calls openRoll with its computed level as the target', () => {
    const openRoll = vi.fn();
    render(<SkillsCard character={makeCharacter()} canWrite={true} openRoll={openRoll} />);

    fireEvent.click(screen.getByRole('button', { name: /Broadsword/ }));
    expect(openRoll).toHaveBeenCalledWith({
      label: 'Broadsword',
      baseTarget: 15,
      presets: undefined,
    });
  });
});
