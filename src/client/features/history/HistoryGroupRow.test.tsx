import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HistoryGroup } from '../../../shared/history/summarize.ts';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';
import { HistoryGroupRow } from './HistoryGroupRow.tsx';

function makeEvent(actorDisplayName: string): HistoryEventOut {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    scope: 'character',
    entityClass: 'character',
    entityId: '00000000-0000-4000-8000-000000000002',
    op: 'update',
    characterId: '00000000-0000-4000-8000-000000000003',
    campaignId: null,
    actorUserId: '00000000-0000-4000-8000-000000000004',
    actorDisplayName,
    batchId: '00000000-0000-4000-8000-000000000005',
    summary: 'ST 10 → 11',
    createdAt: '2026-08-29T17:00:00.000Z',
  };
}

describe('HistoryGroupRow', () => {
  it('truncates a long common actor name in a folded header', () => {
    const actorName = 'An unusually long actor display name that must not crowd out the summary';
    const event = makeEvent(actorName);
    const group: HistoryGroup = {
      batchId: event.batchId,
      events: [event, { ...event, id: '00000000-0000-4000-8000-000000000006', revision: 2 }],
      groupSummary: '2 updates to this item',
      foldable: true,
    };

    render(<HistoryGroupRow group={group} />);

    const actor = screen.getByRole('button').querySelector('span:nth-last-child(2)');
    expect(actor).toHaveTextContent(actorName);
    expect(actor).toHaveClass('truncate', 'max-w-24');
  });
});
