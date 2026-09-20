import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { FloatingPoolsBar, rangePointPercent } from './FloatingPoolsBar.tsx';

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
  it('positions uneven threshold captions at their corresponding range values', () => {
    expect(rangePointPercent(-12, -12, 12)).toBe(0);
    expect(rangePointPercent(0, -12, 12)).toBe(50);
    expect(rangePointPercent(4, -12, 12)).toBeCloseTo(66.667, 2);
    expect(rangePointPercent(12, -12, 12)).toBe(100);

    setup();
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    expect(document.querySelector('[data-range-point="0"]')).toHaveStyle({
      left: '50%',
    });
    expect(document.querySelector('[data-range-point="4"]')).toHaveStyle({
      left: '66.66666666666666%',
    });
  });

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
    expect(screen.getAllByRole('group', { name: / adjustment$/ })).toHaveLength(1);
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

  it('offers precise minus-one and plus-one controls for both pools', () => {
    const { bumpHp, bumpFp } = setup();

    fireEvent.click(screen.getByLabelText('Adjust HP'));
    expect(screen.getByLabelText('HP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease HP by 1' }));
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('9');
    fireEvent.click(screen.getByRole('button', { name: 'Increase HP by 1' }));
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('10');

    fireEvent.click(screen.getByLabelText('Adjust FP'));
    expect(screen.getByLabelText('FP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease FP by 1' }));
    expect(screen.getByLabelText('Current FP')).toHaveTextContent('9');
    fireEvent.click(screen.getByRole('button', { name: 'Increase FP by 1' }));
    expect(screen.getByLabelText('Current FP')).toHaveTextContent('10');

    expect(bumpHp.mock.calls.map(([delta]) => delta)).toEqual([-1, 1]);
    expect(bumpFp.mock.calls.map(([delta]) => delta)).toEqual([-1, 1]);
  });

  it('uses one viewport-fixed panel and dismisses it', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    const panel = screen.getByRole('group', { name: 'FP adjustment' });
    expect(panel).toHaveClass('fixed', 'left-1/2', 'w-[calc(100dvw_-_2rem)]', 'max-w-lg');
    expect(panel).not.toHaveClass('dropdown-content', 'sm:absolute!');

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
