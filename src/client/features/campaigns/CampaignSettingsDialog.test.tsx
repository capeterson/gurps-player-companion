import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { api } from '../../lib/api.ts';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));
vi.mock('./CampaignMembersPanel.tsx', () => ({ CampaignMembersPanel: () => null }));
vi.mock('./CampaignInvitePanel.tsx', () => ({ CampaignInvitePanel: () => null }));
const campaign = {
  id: 'campaign',
  name: 'Campaign',
  ownerId: 'owner',
  members: [],
  manaLevel: 'normal',
  pointTarget: null,
  disadvantageCap: null,
  quirkCap: null,
  techLevel: null,
  shareCharacterSheets: true,
  allowGmCharacterEditing: false,
} as unknown as CampaignOut;
const checkbox = () =>
  screen.getByRole('checkbox', { name: /Armor penetration leaves natural DR intact/ });
beforeEach(() => vi.clearAllMocks());

function setup(viewerRole: 'owner' | 'manager' = 'owner') {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const component = (value: CampaignOut) => (
    <QueryClientProvider client={client}>
      <CampaignSettingsDialog open campaign={value} viewerRole={viewerRole} onClose={onClose} />
    </QueryClientProvider>
  );
  return { ...render(component(campaign)), component, onClose };
}

it('defaults on and saves an explicit off selection, retaining the draft through a refetch', async () => {
  vi.mocked(api).mockResolvedValue({ ...campaign, houseRules: { protectNaturalDr: false } });
  const view = setup();
  expect(checkbox()).toBeChecked();
  fireEvent.click(checkbox());
  view.rerender(view.component({ ...campaign, houseRules: { protectNaturalDr: true } }));
  expect(checkbox()).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ houseRules: { protectNaturalDr: false } }),
      }),
    ),
  );
  await waitFor(() => expect(view.onClose).toHaveBeenCalled());
});

it('retains the draft and displays a save failure so it can be retried', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Offline'));
  const view = setup();
  fireEvent.click(checkbox());
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await screen.findByText('Save failed');
  expect(checkbox()).not.toBeChecked();
  expect(view.onClose).not.toHaveBeenCalled();
});

it('lets managers read the rule but reserves edits for the owner', () => {
  setup('manager');
  expect(checkbox()).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
});
