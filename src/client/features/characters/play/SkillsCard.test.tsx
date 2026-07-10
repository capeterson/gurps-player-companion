/**
 * SkillsCard — usable (non-null-level) skills render sorted by level
 * desc then name, and tapping a row opens the roll sheet at that
 * skill's computed level.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { SkillsCard } from './SkillsCard.tsx';

function makeCharacter(
  overrides: {
    spells?: unknown[];
    manaLevel?: string;
    manaLevelKnown?: boolean;
    traits?: unknown[];
  } = {},
): CharacterDetail {
  return {
    id: 'char-1',
    skills: [
      { id: 's1', name: 'Axe/Mace', level: 12 },
      { id: 's2', name: 'Broadsword', level: 15 },
      { id: 's3', name: 'Unusable (VH, 0 pts)', level: null },
    ],
    spells: overrides.spells ?? [],
    traits: overrides.traits ?? [],
    manaLevel: overrides.manaLevel ?? 'normal',
    manaLevelKnown: overrides.manaLevelKnown ?? true,
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

  const SPELL = { id: 'sp1', name: 'Fireball', level: 14 };

  it('disables Cast when manaLevelKnown is false (campaign row has not synced yet)', () => {
    render(
      <SkillsCard
        character={makeCharacter({ spells: [SPELL], manaLevelKnown: false })}
        canWrite={true}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cast' })).toBeDisabled();
    expect(screen.getByText(/not synced yet/)).toBeInTheDocument();
  });

  it('disables Cast in a no-mana zone even with manaLevelKnown true', () => {
    render(
      <SkillsCard
        character={makeCharacter({ spells: [SPELL], manaLevel: 'none', manaLevelKnown: true })}
        canWrite={true}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cast' })).toBeDisabled();
  });

  it('disables Cast in normal mana without a Magery trait', () => {
    render(
      <SkillsCard
        character={makeCharacter({
          spells: [SPELL],
          manaLevel: 'normal',
          manaLevelKnown: true,
          traits: [],
        })}
        canWrite={true}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cast' })).toBeDisabled();
  });

  it('enables Cast when mana is known and allows casting (Magery present)', () => {
    render(
      <SkillsCard
        character={makeCharacter({
          spells: [SPELL],
          manaLevel: 'normal',
          manaLevelKnown: true,
          traits: [{ name: 'Magery', level: 1 }],
        })}
        canWrite={true}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cast' })).toBeEnabled();
  });

  it('enables Cast in high mana even without Magery', () => {
    render(
      <SkillsCard
        character={makeCharacter({
          spells: [SPELL],
          manaLevel: 'high',
          manaLevelKnown: true,
          traits: [],
        })}
        canWrite={true}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cast' })).toBeEnabled();
  });

  it('hides the Cast button entirely when canWrite is false', () => {
    render(
      <SkillsCard
        character={makeCharacter({ spells: [SPELL] })}
        canWrite={false}
        openRoll={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Cast' })).not.toBeInTheDocument();
  });
});
