import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { getLocalDb, resetLocalDb } from '../../../../db/dexie.ts';
import { tokenStore } from '../../../../lib/tokenStore.ts';
import {
  getSyncOrchestrator,
  resetSyncOrchestratorForTests,
} from '../../../../sync/orchestrator.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import { FloatingPoolsBar, rangePointPercent } from './FloatingPoolsBar.tsx';

vi.mock('../../../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
  resetSyncOrchestratorForTests();
  await resetLocalDb();
});

const LIVE_CHAR_ID = '0193b3c0-f1f0-7000-8000-00000000f001';

function jwtForUser(userId: string): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId })}.signature`;
}

function LivePoolsHarness({ observed }: { observed: number[] }) {
  const db = getLocalDb();
  const combat = useLiveQuery(() => db.characterCombat.get(LIVE_CHAR_ID), [db]);
  const character = {
    id: LIVE_CHAR_ID,
    derived: { hp: 10, fp: 12 },
    combat: combat ?? {
      currentHp: 10,
      currentFp: 8,
      conditions: [],
      maneuver: null,
      posture: 'standing',
    },
  } as unknown as CharacterDetail;
  const bumpers = usePoolBumpers(character, true, useCombatPatch(character));
  useEffect(() => {
    observed.push(bumpers.fp);
  }, [bumpers.fp, observed]);
  return <FloatingPoolsBar character={character} bumpers={bumpers} canWrite />;
}

function setup(hp = 10, fp = 10, max = 12) {
  const character = {
    id: 'character-1',
    combat: { conditions: [] },
  } as unknown as CharacterDetail;
  const bumpHp = vi.fn();
  const bumpFp = vi.fn();
  const setHp = vi.fn();
  const setFp = vi.fn();
  const bumpers: PoolBumpers = {
    hp,
    fp,
    hpMax: max,
    fpMax: max,
    bumpHp,
    bumpFp,
    setHp,
    setFp,
    commitHpDeltas: vi.fn().mockResolvedValue(hp),
    commitFpDeltas: vi.fn().mockResolvedValue(fp),
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
  return { bumpHp, bumpFp, setHp, setFp, rerenderPools, ...view };
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

  it('sends range movement as an absolute transactional target', () => {
    const { setHp, setFp } = setup();
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    fireEvent.change(screen.getByRole('slider', { name: 'Set HP' }), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    fireEvent.change(screen.getByRole('slider', { name: 'Set FP' }), {
      target: { value: '8' },
    });
    expect(setHp).toHaveBeenCalledWith(7);
    expect(setFp).toHaveBeenCalledWith(8);
  });

  it('offers precise minus-one and plus-one controls for both pools', () => {
    const { bumpHp, bumpFp } = setup();

    fireEvent.click(screen.getByLabelText('Adjust HP'));
    expect(screen.getByLabelText('HP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease HP by 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase HP by 1' }));
    expect(bumpHp).toHaveBeenNthCalledWith(1, -1);
    expect(bumpHp).toHaveBeenNthCalledWith(2, 1);

    fireEvent.click(screen.getByLabelText('Adjust FP'));
    expect(screen.getByLabelText('FP step controls')).toHaveClass('join', 'grid', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease FP by 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase FP by 1' }));
    expect(bumpFp).toHaveBeenNthCalledWith(1, -1);
    expect(bumpFp).toHaveBeenNthCalledWith(2, 1);
  });

  it('renders only the durable prop when local observations are skipped or batched', () => {
    const { rerenderPools } = setup(10, 10, 20);
    fireEvent.click(screen.getByLabelText('Adjust HP'));
    rerenderPools(11);
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('11');
    rerenderPools(14);
    expect(screen.getByLabelText('Current HP')).toHaveTextContent('14');
  });

  it('never decreases rendered FP while an upload and stale cursor settle around later clicks', async () => {
    const db = getLocalDb();
    await db.characterCombat.put({
      id: LIVE_CHAR_ID,
      characterId: LIVE_CHAR_ID,
      currentHp: 10,
      currentFp: 8,
      conditions: [],
      maneuver: null,
      posture: 'standing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    });
    tokenStore.write({
      accessToken: jwtForUser('0193b3c0-f1f0-7000-8000-00000000aaaa'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
    });
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let operationCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/sync/operations')) {
          operationCalls += 1;
          const body = JSON.parse(String(init?.body)) as {
            operations: Array<{ clientOpId: string }>;
          };
          if (operationCalls === 1) await firstHeld;
          return new Response(
            JSON.stringify({
              outcomes: body.operations.map((operation) => ({
                clientOpId: operation.clientOpId,
                status: 'applied',
                newRevision: operationCalls + 1,
              })),
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            changes:
              operationCalls === 0
                ? []
                : [
                    {
                      entityClass: 'character_combat',
                      entityId: LIVE_CHAR_ID,
                      command: 'patch',
                      revision: operationCalls,
                      data: {
                        id: LIVE_CHAR_ID,
                        characterId: LIVE_CHAR_ID,
                        currentHp: 10,
                        currentFp: operationCalls === 1 ? 8 : 9,
                        conditions: [],
                        maneuver: null,
                        posture: 'standing',
                        revision: operationCalls,
                      },
                    },
                  ],
            nextCursor: {},
            hasMore: {},
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const observed: number[] = [];
    render(<LivePoolsHarness observed={observed} />);
    const orchestrator = getSyncOrchestrator();
    orchestrator.start();
    try {
      fireEvent.click(screen.getByLabelText('Adjust FP'));
      const increase = screen.getByRole('button', { name: 'Increase FP by 1' });
      fireEvent.click(increase);
      await waitFor(() => expect(screen.getByLabelText('Current FP')).toHaveTextContent('9'));
      await waitFor(() => expect(operationCalls).toBe(1));

      fireEvent.click(increase);
      fireEvent.click(increase);
      fireEvent.click(increase);
      await waitFor(() => expect(screen.getByLabelText('Current FP')).toHaveTextContent('12'));

      releaseFirst();
      await waitFor(() => expect(operationCalls).toBe(2), { timeout: 5_000 });
      await waitFor(async () => expect(await db.outbox.count()).toBe(0));

      expect(screen.getByLabelText('Current FP')).toHaveTextContent('12');
      expect((await db.characterCombat.get(LIVE_CHAR_ID))?.currentFp).toBe(12);
      expect(observed.at(-1)).toBe(12);
      expect(
        observed.every((value, index) => index === 0 || value >= (observed[index - 1] ?? value)),
      ).toBe(true);
    } finally {
      orchestrator.stop();
    }
  });

  it('shows the real soft-cap result instead of predicting a value that rolls back', async () => {
    const db = getLocalDb();
    await db.characterCombat.put({
      id: LIVE_CHAR_ID,
      characterId: LIVE_CHAR_ID,
      currentHp: 10,
      currentFp: 12,
      conditions: [],
      maneuver: null,
      posture: 'standing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    });
    render(<LivePoolsHarness observed={[]} />);
    await waitFor(() => expect(screen.getByLabelText('Adjust FP')).toHaveTextContent('FP12'));
    fireEvent.click(screen.getByLabelText('Adjust FP'));
    const increase = screen.getByRole('button', { name: 'Increase FP by 1' });

    fireEvent.click(increase);
    await db.transaction('rw', db.characterCombat, db.outbox, () => undefined);
    expect(screen.getByLabelText('Current FP')).toHaveTextContent('12');
    expect((await db.characterCombat.get(LIVE_CHAR_ID))?.currentFp).toBe(12);

    fireEvent.click(increase);
    await waitFor(() => expect(screen.getByLabelText('Current FP')).toHaveTextContent('13'));
    expect((await db.characterCombat.get(LIVE_CHAR_ID))?.currentFp).toBe(13);
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
