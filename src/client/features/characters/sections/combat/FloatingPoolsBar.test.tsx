import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { FloatingPoolsBar } from './FloatingPoolsBar.tsx';

function setup(hp = 10, fp = 10) {
  const character = {
    id: 'character-1',
    combat: { conditions: [] },
  } as unknown as CharacterDetail;
  const bumpHp = vi.fn();
  const bumpFp = vi.fn();
  const bumpers: PoolBumpers = {
    hp,
    fp,
    hpMax: 12,
    fpMax: 12,
    bumpHp,
    bumpFp,
    resetHp: vi.fn(),
    resetFp: vi.fn(),
    flashHp: false,
  };
  render(<FloatingPoolsBar character={character} bumpers={bumpers} canWrite />);
  return { bumpHp, bumpFp };
}

describe('FloatingPoolsBar', () => {
  it('labels and exposes both pools with range controls and recovery notes', () => {
    setup();
    const hpButton = screen.getByLabelText('Adjust HP');
    const fpButton = screen.getByLabelText('Adjust FP');
    expect(hpButton).toHaveTextContent('HP10/ 12');
    expect(fpButton).toHaveTextContent('FP10/ 12');
    expect(hpButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('slider', { name: 'Set HP' })).not.toBeInTheDocument();

    fireEvent.click(hpButton);
    expect(screen.getByRole('slider', { name: 'Set HP' })).toHaveClass('range');
    expect(screen.getByText(/HT roll per day/)).toBeInTheDocument();
    expect(screen.getByText(/certain death is −60 HP/)).toHaveClass('text-base-content/45');

    fireEvent.click(fpButton);
    expect(screen.queryByRole('slider', { name: 'Set HP' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Set FP' })).toHaveClass('range');
    expect(screen.getByText(/1 FP per 10 minutes/)).toBeInTheDocument();
  });

  it('converts range movement into incremental local-first pool deltas', () => {
    const { bumpHp, bumpFp } = setup();
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    fireEvent.change(screen.getByRole('slider', { name: 'Set HP' }), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    fireEvent.change(screen.getByRole('slider', { name: 'Set FP' }), {
      target: { value: '8' },
    });
    expect(bumpHp).toHaveBeenCalledWith(-3);
    expect(bumpFp).toHaveBeenCalledWith(-2);
  });

  it('keeps the mobile panel inside the viewport and dismisses it', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    const panel = screen.getByRole('group', { name: 'FP adjustment' });
    expect(panel).toHaveClass('fixed', 'inset-x-4', 'sm:absolute');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'FP adjustment' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Adjust HP'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'HP adjustment' })).not.toBeInTheDocument();
  });

  it('shows derived pool conditions as badges', () => {
    setup(-12, -12);
    for (const status of [
      'Reeling',
      'Tired',
      'Exhausted',
      'Consciousness checks',
      'Death check',
      'Unconscious',
    ]) {
      expect(screen.getByText(status, { selector: '.badge' })).toBeInTheDocument();
    }
  });
});
