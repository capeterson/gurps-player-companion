import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { type CampaignOut, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { characterCreate } from '../../../shared/schemas/character.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { api } from '../../lib/api.ts';
import { GmCampaignDashboardPage } from './GmCampaignDashboardPage.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('../../lib/tokenStore.ts', () => ({ readUserIdFromToken: () => 'gm' }));
vi.mock('./GmChangeFeed.tsx', () => ({ GmChangeFeed: () => null }));
afterEach(() => vi.restoreAllMocks());

it('settles the GM party query without repeatedly rewriting its campaign mirror', async () => {
  const campaign: CampaignOut = {
    id: '0193b3c0-f1f0-7000-8000-00000000ca01',
    name: 'The Lantern Coast',
    ownerId: 'gm',
    description: null,
    pointTarget: 250,
    disadvantageCap: 50,
    quirkCap: 5,
    manaLevel: 'normal',
    houseRules: campaignHouseRules.parse({ ruleSet: 'none', protectNaturalDr: false }),
    techLevel: 3,
    enforceAttributeCaps: true,
    shareCharacterSheets: true,
    allowGmCharacterEditing: false,
    experimentalTurnTracker: true,
    members: [],
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    revision: 1,
  };
  const db = getLocalDb();
  await db.characters.put({
    ...characterCreate.parse({ name: 'Kestrel Vale' }),
    id: '0193b3c0-f1f0-7000-8000-00000000ca02',
    ownerId: 'rowan',
    campaignId: campaign.id,
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    dismissedWarnings: [],
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    revision: 1,
  });
  const writes = vi.spyOn(db.campaigns, 'bulkPut');
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/auth/me' ? { id: 'gm' } : campaign,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/campaigns/${campaign.id}/gm`]}>
        <Routes>
          <Route path="/campaigns/:id/gm" element={<GmCampaignDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  try {
    expect(await screen.findByRole('heading', { name: 'Kestrel Vale' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dense' }));
    await act(async () => {
      await db.campaigns.get(campaign.id);
    });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading local character data…')).not.toBeInTheDocument();
    act(() =>
      client.setQueryData(['campaigns', campaign.id], {
        ...campaign,
        name: 'Updated coast',
        revision: 2,
      }),
    );
    await waitFor(async () =>
      expect((await db.campaigns.get(campaign.id))?.name).toBe('Updated coast'),
    );
    expect(writes).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Kestrel Vale' })).toBeInTheDocument();
  } finally {
    unmount();
    client.clear();
  }
});
