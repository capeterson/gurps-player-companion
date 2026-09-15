import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel.tsx';
import { __resetRollHistoryForTests, pushRoll } from './rollHistory.ts';

vi.mock('../../../features/history/useHistoryQuery.ts', () => ({
  useCharacterHistory: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              revision: 1,
              scope: 'character',
              entityClass: 'character',
              entityId: '00000000-0000-4000-8000-000000000002',
              op: 'update',
              characterId: 'char-1',
              campaignId: null,
              actorUserId: '00000000-0000-4000-8000-000000000003',
              actorDisplayName: 'Player',
              batchId: null,
              summary: 'ST 10 → 11',
              createdAt: '2026-09-14T20:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

afterEach(() => {
  __resetRollHistoryForTests();
});

describe('HistoryPanel', () => {
  it('defaults to change history and switches to device-only roll browsing', () => {
    act(() => {
      pushRoll({
        id: 'roll-1',
        at: new Date('2026-09-14T21:30:00.000Z'),
        characterId: 'char-1',
        label: 'Dodge',
        kind: 'check',
        target: 12,
        dice: [2, 3, 4],
        total: 9,
        margin: 3,
        crit: null,
      });
    });

    render(<HistoryPanel characterId="char-1" />);

    const changeHistoryTab = screen.getByRole('tab', { name: 'Change history' });
    const rollHistoryTab = screen.getByRole('tab', { name: 'Roll history' });
    expect(changeHistoryTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('ST 10 → 11')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Roll history entries' })).not.toBeInTheDocument();

    changeHistoryTab.focus();
    fireEvent.keyDown(changeHistoryTab, { key: 'ArrowRight' });

    expect(rollHistoryTab).toHaveFocus();
    expect(rollHistoryTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('ST 10 → 11')).not.toBeInTheDocument();
    expect(
      screen.getByText('Up to 250 rolls — saved on this device only and never synced.'),
    ).toBeInTheDocument();
    const rollHistory = screen.getByRole('list', { name: 'Roll history entries' });
    expect(rollHistory).toHaveTextContent('Dodge');
    expect(rollHistory).toHaveTextContent('vs 12');
    expect(rollHistory).toHaveTextContent('[2 3 4]');
    expect(rollHistory).toHaveTextContent('+3');
  });
});
