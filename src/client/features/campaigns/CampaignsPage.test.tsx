import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { type CampaignOut, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { api } from '../../lib/api.ts';
import { CampaignsPage } from './CampaignsPage.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('./InvitationsInbox.tsx', () => ({ InvitationsInbox: () => null }));

it('lists real campaign information without implying cover-image support', async () => {
  const campaign: CampaignOut = {
    id: '0193b3c0-f1f0-7000-8000-00000000ca01',
    name: 'The Lantern Coast',
    description: 'Storm-wrapped islands',
    ownerId: 'owner',
    pointTarget: 250,
    disadvantageCap: 50,
    quirkCap: 5,
    manaLevel: 'normal',
    techLevel: 3,
    enforceAttributeCaps: true,
    shareCharacterSheets: true,
    allowGmCharacterEditing: false,
    experimentalTurnTracker: false,
    houseRules: campaignHouseRules.parse({}),
    members: [{ userId: 'owner', email: 'gm@example.com', displayName: 'GM', role: 'owner' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/auth/me' ? { id: 'owner', email: 'gm@example.com', displayName: 'GM' } : [campaign],
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Campaigns' })).toBeInTheDocument();
  expect(await screen.findByText(/Storm-wrapped islands/)).toBeInTheDocument();
  expect(screen.queryByText('cover', { exact: false })).not.toBeInTheDocument();
});
