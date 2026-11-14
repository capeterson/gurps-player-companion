import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { HistoryEventOut } from '../../../shared/schemas/history.ts';
import {
  type EntityClass,
  LIBRARY_ENTITY_CLASSES,
  entityClass,
} from '../../../shared/schemas/sync.ts';
import { HistoryList } from './HistoryList.tsx';

function event(entityClass: EntityClass, index: number): HistoryEventOut {
  return {
    id: `id-${index}`,
    revision: index,
    scope: 'campaign',
    entityClass,
    entityId: `entity-${index}`,
    op: index % 2 ? 'update' : 'insert',
    characterId: null,
    campaignId: null,
    actorUserId: null,
    actorDisplayName: null,
    batchId: null,
    summary: `Event ${entityClass}`,
    createdAt: '2026-08-29T17:00:00.000Z',
  };
}
const events = [
  event('campaign', 1),
  event('campaign_membership', 2),
  ...LIBRARY_ENTITY_CLASSES.map((entry, index) => event(entry, index + 3)),
];
const props = {
  events,
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  onLoadMore: vi.fn(),
};

it('filters every campaign library category and composes search and operation filters', () => {
  expect(LIBRARY_ENTITY_CLASSES).toHaveLength(12);
  expect([...LIBRARY_ENTITY_CLASSES].sort()).toEqual(
    entityClass.options.filter((name) => name.startsWith('campaign_library_')).sort(),
  );
  render(<HistoryList {...props} scope="campaign" />);
  fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  expect(screen.queryByText('Event campaign')).not.toBeInTheDocument();
  expect(screen.queryByText('Event campaign_membership')).not.toBeInTheDocument();
  for (const category of LIBRARY_ENTITY_CLASSES)
    expect(screen.getByText(`Event ${category}`)).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), {
    target: { value: 'campaign_library_trait' },
  });
  expect(screen.getByText('Event campaign_library_trait')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Changed' }));
  const trait = events.find((entry) => entry.entityClass === 'campaign_library_trait');
  expect(trait).toBeDefined();
  if (trait?.op === 'update')
    expect(screen.getByText('Event campaign_library_trait')).toBeVisible();
  else expect(screen.getByText('No matches.')).toBeVisible();
});

it('switches category families and resets incompatible selection while retaining search and operation', () => {
  const { rerender } = render(<HistoryList {...props} scope="campaign" />);
  fireEvent.click(screen.getByRole('button', { name: 'Members' }));
  expect(screen.getByText('Event campaign_membership')).toBeVisible();
  expect(screen.queryByText('Event campaign')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), {
    target: { value: 'Event' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Added' }));
  rerender(<HistoryList {...props} scope="character" events={[event('character_trait', 2)]} />);
  expect(screen.getByRole('button', { name: 'Traits' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Added' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('searchbox')).toHaveValue('Event');
  expect(screen.getByText('Event character_trait')).toBeVisible();
  rerender(<HistoryList {...props} scope="campaign" />);
  expect(screen.getByRole('button', { name: 'Members' })).toHaveAttribute('aria-pressed', 'false');
  expect(
    within(screen.getByRole('button', { name: 'Campaign' })).getByText('Campaign'),
  ).toBeVisible();
});

it('requests authorized detail only when its row is opened', async () => {
  const allowed = { ...event('campaign_library_trait', 3), summary: 'Allowed library detail' };
  const restricted = { ...event('character_trait', 4), summary: 'Restricted character summary' };
  const loadDetails = vi
    .fn()
    .mockResolvedValue({ ...allowed, oldRow: { name: 'old' }, newRow: { name: 'new' } });
  render(
    <HistoryList
      {...props}
      scope="campaign"
      events={[allowed, restricted]}
      showDetails={(entry) => entry.entityClass === 'campaign_library_trait'}
      loadDetails={loadDetails}
    />,
  );
  expect(screen.getByText('Restricted character summary').closest('summary')).toBeNull();
  expect(loadDetails).not.toHaveBeenCalled();
  const detail = screen.getByText('Allowed library detail').closest('details');
  if (!detail) throw new Error('Expected expandable history detail');
  detail.open = true;
  const field = await screen.findByText('Name');
  expect(field.nextElementSibling).toHaveTextContent('old');
  expect(field.nextElementSibling).toHaveTextContent('new');
  expect(loadDetails).toHaveBeenCalledOnce();
  expect(loadDetails).toHaveBeenCalledWith(allowed);
});
