import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { FloatingPoolsBar, rangePointPercent } from './FloatingPoolsBar.tsx';

function setup(hp = 10, fp = 10, max = 12) {
  const character = {
    id: 'character-1',
    combat: { conditions: [] },
  } as unknown as CharacterDetail;
  const bumpHp = vi.fn();
  const bumpFp = vi.fn();
  const bumpers: PoolBumpers = {
    hp,
    fp,
    hpMax: max,
    fpMax: max,
    bumpHp,
    bumpFp,
    resetHp: vi.fn(),
    resetFp: vi.fn(),
    flashHp: false,
  };
  const view = render(<FloatingPoolsBar character={character} bumpers={bumpers} canWrite />);
  return { bumpHp, bumpFp, ...view };
}

describe('FloatingPoolsBar', () => {
  it('anchors visible uneven-threshold labels at their corresponding range values', () => {
    // Exhaust every positive maximum the character schema can produce:
    // base ST/HT (99) + permanent modifier (50) + temporary pool modifier (50).
    for (let maximum = 1; maximum <= 199; maximum += 1) {
      expect(rangePointPercent(-maximum, -maximum, maximum)).toBe(0);
      expect(rangePointPercent(0, -maximum, maximum)).toBe(50);
      expect(rangePointPercent(Math.ceil(maximum / 3), -maximum, maximum)).toBeCloseTo(
        ((Math.ceil(maximum / 3) + maximum) / (2 * maximum)) * 100,
        8,
      );
      expect(rangePointPercent(maximum, -maximum, maximum)).toBe(100);
    }

    setup(0, 8, 15);
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    for (const [value, left, anchor] of [
      [-15, '0%', 'start'],
      [0, '50%', 'center'],
      [5, '66.66666666666666%', 'center'],
      [15, '100%', 'end'],
    ] as const) {
      expect(document.querySelector(`[data-range-point="${value}"]`)).toHaveStyle({ left });
      expect(document.querySelector(`[data-range-label="${value}"]`)).toHaveStyle({ left });
      expect(document.querySelector(`[data-range-label="${value}"]`)).toHaveAttribute(
        'data-range-anchor',
        anchor,
      );
    }
  });

  it('derives rendered threshold labels from each character pool maximum', () => {
    for (const maximum of [1, 7, 15, 37, 99, 199]) {
      const { unmount } = setup(maximum, maximum, maximum);
      fireEvent.click(screen.getByLabelText('Adjust HP'));

      const threshold = Math.ceil(maximum / 3);
      const thresholdLabel = screen.getByText('Reeling ends').closest('[data-range-label]');
      expect(thresholdLabel).toHaveAttribute('data-range-label', String(threshold));
      expect(thresholdLabel).toHaveStyle({
        left: `${rangePointPercent(threshold, -maximum, maximum)}%`,
      });
      expect(screen.getByText('Death check').closest('[data-range-label]')).toHaveAttribute(
        'data-range-label',
        String(-maximum),
      );
      expect(screen.getByText('Full').closest('[data-range-label]')).toHaveAttribute(
        'data-range-label',
        String(maximum),
      );

      unmount();
    }
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
