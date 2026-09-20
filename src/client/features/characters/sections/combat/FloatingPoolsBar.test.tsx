import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { FloatingPoolsBar, rangePointPercent } from './FloatingPoolsBar.tsx';

function setup(
  hp = 10,
  fp = 10,
  max = 12,
  commits?: {
    hp?: PoolBumpers['commitHpDeltas'];
    fp?: PoolBumpers['commitFpDeltas'];
  },
) {
  const character = {
    id: 'character-1',
    combat: { conditions: [] },
  } as unknown as CharacterDetail;
  const bumpHp = vi.fn();
  const bumpFp = vi.fn();
  const commitHpDeltas = commits?.hp ?? vi.fn().mockResolvedValue(hp);
  const commitFpDeltas = commits?.fp ?? vi.fn().mockResolvedValue(fp);
  const bumpers: PoolBumpers = {
    hp,
    fp,
    hpMax: max,
    fpMax: max,
    bumpHp,
    bumpFp,
    commitHpDeltas,
    commitFpDeltas,
    resetHp: vi.fn(),
    resetFp: vi.fn(),
    flashHp: false,
  };
  const view = render(<FloatingPoolsBar character={character} bumpers={bumpers} canWrite />);
  const rerenderPools = (nextHp: number, nextFp = fp) =>
    view.rerender(
      <FloatingPoolsBar
        character={character}
        bumpers={{ ...bumpers, hp: nextHp, fp: nextFp }}
        canWrite
      />,
    );
  return { bumpHp, bumpFp, commitHpDeltas, commitFpDeltas, rerenderPools, ...view };
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

  it('converts range movement into incremental local-first pool deltas', async () => {
    const { commitHpDeltas, commitFpDeltas } = setup();
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    fireEvent.change(screen.getByRole('slider', { name: 'Set HP' }), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    await act(async () => undefined);
    fireEvent.change(screen.getByRole('slider', { name: 'Set FP' }), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    await act(async () => undefined);
    expect(commitHpDeltas).toHaveBeenCalledWith([expect.objectContaining({ delta: -3 })]);
    expect(commitFpDeltas).toHaveBeenCalledWith([expect.objectContaining({ delta: -2 })]);
  });

  it('offers precise minus-one and plus-one controls for both pools', async () => {
    const { bumpHp, bumpFp, commitHpDeltas, commitFpDeltas } = setup();

    fireEvent.click(screen.getByLabelText('Adjust HP'));
    expect(screen.getByLabelText('HP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease HP by 1' }));
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('9');
    fireEvent.click(screen.getByRole('button', { name: 'Increase HP by 1' }));
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('10');

    // Switching panels unmounts HP and must flush rather than drop its debounced tail.
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    await act(async () => undefined);
    expect(commitHpDeltas).toHaveBeenCalledWith([
      expect.objectContaining({ delta: -1 }),
      expect.objectContaining({ delta: 1 }),
    ]);
    expect(screen.getByLabelText('FP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease FP by 1' }));
    expect(screen.getByLabelText('Current FP')).toHaveTextContent('9');
    fireEvent.click(screen.getByRole('button', { name: 'Increase FP by 1' }));
    expect(screen.getByLabelText('Current FP')).toHaveTextContent('10');
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    await act(async () => undefined);
    expect(commitFpDeltas).toHaveBeenCalledWith([
      expect.objectContaining({ delta: -1 }),
      expect.objectContaining({ delta: 1 }),
    ]);

    expect(bumpHp).not.toHaveBeenCalled();
    expect(bumpFp).not.toHaveBeenCalled();
  });

  it('debounces a mashed step-button burst into one ordered relative commit', async () => {
    vi.useFakeTimers();
    try {
      const commitHpDeltas = vi.fn(async (gestures: readonly { delta: number }[]) =>
        gestures.reduce((value, gesture) => value + gesture.delta, 10),
      );
      setup(10, 10, 20, { hp: commitHpDeltas });
      fireEvent.click(screen.getByLabelText('Adjust HP'));
      const decrease = screen.getByRole('button', { name: 'Decrease HP by 1' });
      for (let index = 0; index < 16; index += 1) fireEvent.click(decrease);

      expect(screen.getByLabelText('Current HP')).toHaveTextContent('-6');
      expect(commitHpDeltas).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(199));
      expect(commitHpDeltas).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(commitHpDeltas).toHaveBeenCalledTimes(1);
      expect(commitHpDeltas.mock.calls[0]?.[0].map(({ delta }) => delta)).toEqual(
        Array.from({ length: 16 }, () => -1),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebases an unflushed burst onto a newer synced pool value', async () => {
    vi.useFakeTimers();
    try {
      let syncedHp = 10;
      const commitHpDeltas = vi.fn(async (gestures: readonly { delta: number }[]) => {
        syncedHp += gestures.reduce((sum, gesture) => sum + gesture.delta, 0);
        return syncedHp;
      });
      const { rerenderPools } = setup(10, 10, 20, { hp: commitHpDeltas });
      fireEvent.click(screen.getByLabelText('Adjust HP'));
      const decrease = screen.getByRole('button', { name: 'Decrease HP by 1' });
      fireEvent.click(decrease);
      fireEvent.click(decrease);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('8');

      syncedHp = 14;
      rerenderPools(14);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('12');
      await act(async () => vi.advanceTimersByTimeAsync(200));

      expect(commitHpDeltas).toHaveBeenCalledTimes(1);
      expect(await commitHpDeltas.mock.results[0]?.value).toBe(12);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('12');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a second burst queued while the rebased first commit is still settling', async () => {
    vi.useFakeTimers();
    try {
      let releaseFirst!: (value: number) => void;
      const first = new Promise<number>((resolve) => {
        releaseFirst = resolve;
      });
      const commitHpDeltas = vi
        .fn<PoolBumpers['commitHpDeltas']>()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(11);
      const { rerenderPools } = setup(10, 10, 20, { hp: commitHpDeltas });
      fireEvent.click(screen.getByLabelText('Adjust HP'));
      const decrease = screen.getByRole('button', { name: 'Decrease HP by 1' });
      fireEvent.click(decrease);
      fireEvent.click(decrease);
      await act(async () => vi.advanceTimersByTimeAsync(200));
      expect(commitHpDeltas).toHaveBeenCalledTimes(1);

      // A cursor update wins the transaction race and becomes the first burst's base.
      rerenderPools(14);
      fireEvent.click(decrease);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('11');
      await act(async () => vi.advanceTimersByTimeAsync(200));
      expect(commitHpDeltas).toHaveBeenCalledTimes(1);

      await act(async () => releaseFirst(12));
      expect(commitHpDeltas).toHaveBeenCalledTimes(2);
      expect(
        commitHpDeltas.mock.calls.map(([gestures]) => gestures.map(({ delta }) => delta)),
      ).toEqual([[-1, -1], [-1]]);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('11');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count a LiveQuery acknowledgement twice when it renders before commit settles', async () => {
    vi.useFakeTimers();
    try {
      let releaseFirst!: (value: number) => void;
      const first = new Promise<number>((resolve) => {
        releaseFirst = resolve;
      });
      const commitHpDeltas = vi
        .fn<PoolBumpers['commitHpDeltas']>()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(8);
      const { rerenderPools } = setup(10, 10, 20, { hp: commitHpDeltas });
      fireEvent.click(screen.getByLabelText('Adjust HP'));
      const decrease = screen.getByRole('button', { name: 'Decrease HP by 1' });
      fireEvent.click(decrease);
      await act(async () => vi.advanceTimersByTimeAsync(200));

      // Dexie's observer may render the transaction result before the async
      // caller's continuation records that same result.
      rerenderPools(9);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('9');
      fireEvent.click(decrease);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('8');
      await act(async () => vi.advanceTimersByTimeAsync(200));
      await act(async () => releaseFirst(9));

      expect(commitHpDeltas).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('8');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the optimistic display to the durable value when a burst cannot commit', async () => {
    vi.useFakeTimers();
    try {
      const commitHpDeltas = vi.fn().mockResolvedValue(undefined);
      setup(10, 10, 20, { hp: commitHpDeltas });
      fireEvent.click(screen.getByLabelText('Adjust HP'));
      fireEvent.click(screen.getByRole('button', { name: 'Decrease HP by 1' }));
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('9');

      await act(async () => vi.advanceTimersByTimeAsync(200));

      expect(commitHpDeltas).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Current HP')).toHaveTextContent('10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps one panel viewport-fixed when narrow and trigger-anchored on desktop', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    const panel = screen.getByRole('group', { name: 'FP adjustment' });
    expect(panel).toHaveClass(
      'dropdown-content',
      'fixed!',
      'left-1/2!',
      'w-[calc(100dvw_-_2rem)]',
      'max-w-lg',
      'lg:absolute!',
      'lg:left-0!',
      'lg:top-full!',
      'lg:translate-x-0',
    );
    expect(panel.parentElement).toHaveClass('dropdown', 'dropdown-start', 'dropdown-open');
    expect(screen.getAllByRole('group', { name: / adjustment$/ })).toHaveLength(1);

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
