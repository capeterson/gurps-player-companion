import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('expands a campaign-library row into field changes and raw snapshots', () => {
    const event: HistoryEventOut = {
      ...makeEvent('Library GM'),
      scope: 'campaign',
      entityClass: 'campaign_library_trait',
      summary: 'Library trait Combat Reflexes: Description updated',
      oldRow: {
        name: 'Combat Reflexes',
        description: 'Old description',
        revision: 12,
      },
      newRow: {
        name: 'Combat Reflexes',
        description: 'New description',
        revision: 13,
      },
    };
    const group: HistoryGroup = {
      batchId: event.batchId,
      events: [event],
      groupSummary: event.summary,
      foldable: false,
    };

    const { container } = render(
      <HistoryGroupRow
        group={group}
        showDetails={(candidate) => candidate.entityClass.startsWith('campaign_library_')}
      />,
    );

    const row = screen.getByText(event.summary).closest('summary');
    expect(row).not.toBeNull();
    expect(screen.queryByText('Description')).not.toBeVisible();

    fireEvent.click(row as HTMLElement);

    const description = screen.getByText('Description');
    expect(description).toBeVisible();
    expect(description.nextElementSibling).toHaveTextContent('Old description');
    expect(description.nextElementSibling).toHaveTextContent('New description');
    expect(screen.getByText('Raw')).toBeVisible();

    const raw = screen.getByText('Raw').closest('details');
    fireEvent.click(screen.getByText('Raw'));
    expect(raw).toHaveAttribute('open');
    expect(container.querySelector('pre:last-child')).toHaveTextContent('"before"');
    expect(container.querySelector('pre:last-child')).toHaveTextContent('"after"');
  });

  it('loads campaign-library snapshots only after the row is opened', async () => {
    const event: HistoryEventOut = {
      ...makeEvent('Library GM'),
      scope: 'campaign',
      entityClass: 'campaign_library_skill',
      summary: 'Library skill First Aid: Difficulty updated',
    };
    const detailedEvent: HistoryEventOut = {
      ...event,
      oldRow: { name: 'First Aid', difficulty: 'E' },
      newRow: { name: 'First Aid', difficulty: 'A' },
    };
    const loadDetails = vi.fn().mockResolvedValue(detailedEvent);
    const group: HistoryGroup = {
      batchId: event.batchId,
      events: [event],
      groupSummary: event.summary,
      foldable: false,
    };

    render(<HistoryGroupRow group={group} showDetails={() => true} loadDetails={loadDetails} />);

    expect(loadDetails).not.toHaveBeenCalled();
    const row = screen.getByText(event.summary).closest('summary');
    fireEvent.click(row as HTMLElement);

    await waitFor(() => expect(screen.getByText('Difficulty')).toBeVisible());
    expect(loadDetails).toHaveBeenCalledOnce();
    expect(loadDetails).toHaveBeenCalledWith(event);

    fireEvent.click(row as HTMLElement);
    fireEvent.click(row as HTMLElement);
    expect(loadDetails).toHaveBeenCalledOnce();
  });
});
