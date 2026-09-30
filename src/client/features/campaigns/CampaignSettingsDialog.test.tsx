import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { type CampaignOut, campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import { api } from '../../lib/api.ts';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
vi.mock('../../lib/toast.tsx', () => ({ useToasts: () => ({ push: vi.fn() }) }));
vi.mock('../../components/MediaImage.tsx', () => ({
  MediaImage: () => <input type="file" aria-label="Upload campaign cover" />,
}));
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
  enforceAttributeCaps: true,
  shareCharacterSheets: true,
  allowGmCharacterEditing: false,
} as unknown as CampaignOut;
const checkbox = () =>
  screen.getByRole('checkbox', { name: /Armor penetration leaves natural DR intact/ });
beforeEach(() => vi.clearAllMocks());

function setup(
  viewerRole: 'owner' | 'manager' = 'owner',
  campaignOrAvailability: CampaignOut | boolean = campaign,
  availability = true,
) {
  const initialCampaign =
    typeof campaignOrAvailability === 'boolean' ? campaign : campaignOrAvailability;
  const onlineAvailable =
    typeof campaignOrAvailability === 'boolean' ? campaignOrAvailability : availability;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const component = (value: CampaignOut, available = onlineAvailable) => (
    <QueryClientProvider client={client}>
      <CampaignSettingsDialog
        open
        campaign={value}
        viewerRole={viewerRole}
        onlineAvailable={available}
        onClose={onClose}
      />
    </QueryClientProvider>
  );
  return { ...render(component(initialCampaign)), component, onClose };
}

it('defaults on and saves an explicit off selection, retaining the draft through a refetch', async () => {
  vi.mocked(api).mockResolvedValue({ ...campaign, houseRules: { protectNaturalDr: false } });
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  expect(checkbox()).toBeChecked();
  fireEvent.click(checkbox());
  view.rerender(
    view.component({
      ...campaign,
      houseRules: campaignHouseRules.parse({ protectNaturalDr: true }),
    }),
  );
  expect(checkbox()).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          houseRules: expect.objectContaining({
            ruleSet: 'custom',
            protectNaturalDr: false,
          }),
        }),
      }),
    ),
  );
  await waitFor(() => expect(view.onClose).toHaveBeenCalled());
});

it('retains the draft and displays a save failure so it can be retried', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Offline'));
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  fireEvent.click(checkbox());
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await screen.findByText('Save failed');
  expect(checkbox()).not.toBeChecked();
  expect(view.onClose).not.toHaveBeenCalled();
});

it('lets managers read the rule but reserves edits for the owner', () => {
  setup('manager');
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  expect(checkbox()).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
});

it('preserves the J Talisar bundle when moving from the named set to Custom', async () => {
  vi.mocked(api).mockResolvedValue(campaign);
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

  const selector = screen.getByRole('combobox', { name: 'House rule set' });
  fireEvent.change(selector, { target: { value: 'j_talisar' } });

  fireEvent.click(screen.getByText('Magic', { selector: 'summary' }));
  const acidMagic = screen.getByRole('checkbox', { name: /Acid magic is forbidden/ });
  expect(checkbox()).toBeChecked();
  expect(acidMagic).toBeChecked();
  expect(acidMagic).toBeDisabled();

  fireEvent.change(selector, { target: { value: 'custom' } });
  expect(checkbox()).toBeChecked();
  expect(acidMagic).toBeChecked();
  expect(acidMagic).toBeEnabled();

  fireEvent.click(acidMagic);
  expect(acidMagic).not.toBeChecked();
  expect(checkbox()).toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          enforceAttributeCaps: true,
          houseRules: expect.objectContaining({
            ruleSet: 'custom',
            forbidAcidMagic: false,
            forbidDistantBlow: true,
            protectNaturalDr: true,
          }),
        }),
      }),
    ),
  );
});

it('requires owner opt-in for experimental tracking and keeps the choice after a failed save', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(campaign);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  const tracker = screen.getByRole('checkbox', { name: /Enable turn tracker/ });
  expect(tracker).not.toBeChecked();
  fireEvent.click(tracker);
  view.rerender(view.component({ ...campaign, experimentalTurnTracker: false }));
  expect(tracker).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await screen.findByText('Save failed');
  expect(tracker).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(view.onClose).toHaveBeenCalled());
  expect(api).toHaveBeenLastCalledWith(
    '/campaigns/campaign',
    expect.objectContaining({
      body: expect.objectContaining({ experimentalTurnTracker: true }),
    }),
  );
});

it('does not let managers enable experimental tracking', () => {
  setup('manager');
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  expect(screen.getByRole('checkbox', { name: /Enable turn tracker/ })).toBeDisabled();
});

it('defaults active effects off, lets the owner enable them, and persists the flag', async () => {
  const enabled = { ...campaign, experimentalActiveEffects: true } as CampaignOut;
  vi.mocked(api).mockResolvedValue(enabled);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  const activeEffects = screen.getByRole('checkbox', { name: /^Enable active effects/ });
  expect(activeEffects).not.toBeChecked();
  fireEvent.click(activeEffects);
  expect(activeEffects).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ experimentalActiveEffects: true }),
      }),
    ),
  );
  await waitFor(() => expect(view.onClose).toHaveBeenCalled());
});

it('lets the owner disable active effects for a campaign that already has them enabled', async () => {
  vi.mocked(api).mockResolvedValue({ ...campaign, experimentalActiveEffects: false });
  setup('owner', { ...campaign, experimentalActiveEffects: true } as CampaignOut);
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  const activeEffects = screen.getByRole('checkbox', { name: /^Enable active effects/ });
  await waitFor(() => expect(activeEffects).toBeChecked());
  fireEvent.click(activeEffects);
  expect(activeEffects).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/campaigns/campaign',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ experimentalActiveEffects: false }),
      }),
    ),
  );
});

it('does not let managers enable active effects', () => {
  setup('manager');
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  const activeEffects = screen.getByRole('checkbox', { name: /^Enable active effects/ });
  expect(activeEffects).not.toBeChecked();
  expect(activeEffects).toBeDisabled();
});

it('groups settings and preserves form drafts across sections', () => {
  setup();
  expect(screen.getByLabelText('Upload campaign cover')).toBeVisible();
  expect(screen.getByText(/Image changes save separately/)).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Point target' }), {
    target: { value: '275' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  expect(screen.getByRole('combobox', { name: 'House rule set' })).toBeVisible();
  expect(screen.queryByLabelText('Upload campaign cover')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Campaign' }));
  expect(screen.getByRole('textbox', { name: 'Point target' })).toHaveValue('275');
});

it('keeps the local cover editor available while online settings are unavailable', () => {
  setup('owner', false);
  expect(screen.getByLabelText('Upload campaign cover')).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Point target' })).toBeDisabled();
  expect(screen.getByText(/Connect to change campaign rules/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Members' }));
  expect(screen.queryByText('Delete campaign…')).not.toBeInTheDocument();
});

it('hydrates newly available remote settings before enabling edits, then preserves drafts', () => {
  const view = setup('owner', false);
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
  view.rerender(view.component({ ...campaign, pointTarget: 250 }, true));
  expect(screen.getByRole('button', { name: 'Rules' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Campaign' }));
  const target = screen.getByRole('textbox', { name: 'Point target' });
  expect(target).toHaveValue('250');
  expect(target).toBeEnabled();
  fireEvent.change(target, { target: { value: '275' } });
  view.rerender(view.component({ ...campaign, pointTarget: 300 }, true));
  expect(target).toHaveValue('275');
});
