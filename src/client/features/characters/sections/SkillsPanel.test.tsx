/**
 * SkillsPanel — the "Lvl" cell as a tappable roll target.
 *
 * A computed level opens the shared Play Mode roll sheet at that
 * target (rolls mutate nothing, so this works identically for
 * read-only viewers); a null level (0-point Very Hard skill, which has
 * no attribute default per B173) stays plain, non-interactive text.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import type { SkillOut } from '../../../../shared/schemas/skill.ts';
import { ToastProvider } from '../../../lib/toast.tsx';
import { SkillsPanel } from './SkillsPanel.tsx';

function makeSkill(overrides: Partial<SkillOut> = {}): SkillOut {
  return {
    id: 'skill-1',
    characterId: 'char-1',
    name: 'Broadsword',
    attribute: 'DX',
    difficulty: 'A',
    points: 8,
    techLevel: null,
    specialization: null,
    notes: null,
    librarySkillId: null,
    level: 14,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCharacter(skills: SkillOut[]): CharacterDetail {
  return {
    id: 'char-1',
    campaignId: null,
    skills,
  } as unknown as CharacterDetail;
}

function renderPanel(character: CharacterDetail, canWrite = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<SkillsPanel character={character} canWrite={canWrite} />, { wrapper: Wrapper });
}

describe('SkillsPanel', () => {
  it('renders a roll button for a skill with a computed level that opens the roll sheet at that target', () => {
    const skill = makeSkill({ name: 'Broadsword', level: 14 });
    renderPanel(makeCharacter([skill]));

    const button = screen.getByRole('button', { name: 'Roll Broadsword' });
    fireEvent.click(button);

    expect(screen.getByRole('dialog', { name: 'Roll Broadsword' })).toBeInTheDocument();
    expect(screen.getByLabelText('Effective target 14')).toBeInTheDocument();
  });

  it('does not make a null-level skill cell a button', () => {
    const skill = makeSkill({
      name: 'Thaumatology',
      difficulty: 'VH',
      points: 0,
      level: null,
    });
    renderPanel(makeCharacter([skill]));

    expect(screen.queryByRole('button', { name: 'Roll Thaumatology' })).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('works for read-only viewers too, since a roll mutates nothing', () => {
    const skill = makeSkill({ name: 'Stealth', level: 12 });
    renderPanel(makeCharacter([skill]), false);

    const button = screen.getByRole('button', { name: 'Roll Stealth' });
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Roll Stealth' })).toBeInTheDocument();
  });
});
