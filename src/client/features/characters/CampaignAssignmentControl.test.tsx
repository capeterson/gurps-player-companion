import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type LocalCampaign, type LocalCharacter, getLocalDb } from '../../db/dexie.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { flashBus, makeFlashKey } from '../../sync/flashBus.ts';
import * as outbox from '../../sync/outbox.ts';
import { CampaignAssignmentControl } from './CampaignAssignmentControl.tsx';

const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000ca01';
const OTHER_CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000ca04';
const FIRST_CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca02';
const SECOND_CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000ca03';
const time = '2026-10-04T00:00:00.000Z';

function campaign(id: string, name: string): LocalCampaign {
  return {
    id,
    name,
    description: null,
    ownerId: '0193b3c0-f1f0-7000-8000-00000000ca05',
    pointTarget: null,
    disadvantageCap: null,
    quirkCap: null,
    createdAt: time,
    updatedAt: time,
    revision: 1,
  };
}

const character: LocalCharacter = {
  id: CHARACTER_ID,
  ownerId: 'owner',
  campaignId: FIRST_CAMPAIGN_ID,
  name: 'Campaign Test Hero',
  height: null,
  weight: null,
  age: null,
  birthdate: null,
  appearance: null,
  st: 10,
  dx: 10,
  iq: 10,
  ht: 10,
  hpMod: 0,
  willMod: 0,
  perMod: 0,
  fpMod: 0,
  speedQuarterMod: 0,
  moveMod: 0,
  dismissedWarnings: [],
  activeConditionGroups: [],
  createdAt: time,
  updatedAt: time,
  revision: 3,
};

async function seed(campaignId: string | null = FIRST_CAMPAIGN_ID) {
  const db = getLocalDb();
  await db.campaigns.bulkPut([
    campaign(FIRST_CAMPAIGN_ID, 'The Amber Marches and its Long Campaign Title'),
    campaign(SECOND_CAMPAIGN_ID, 'The Sapphire Coast'),
  ]);
  await db.characters.put({ ...character, campaignId });
}

function renderControl(
  props: Partial<{ characterId: string; campaignId: string | null; canWrite: boolean }> = {},
) {
  const values = {
    characterId: CHARACTER_ID,
    campaignId: FIRST_CAMPAIGN_ID,
    canWrite: true,
    ...props,
  };
  const view = render(
    <MemoryRouter>
      <RouteProbe />
      <ToastProvider>
        <CampaignAssignmentControl {...values} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { ...view, values };
}

function RouteProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

function editButton() {
  return screen.getByRole('button', { name: 'Edit campaign' });
}

async function openEditor() {
  fireEvent.click(editButton());
  const warning = screen.getByRole('dialog', { name: 'Change character campaign?' });
  expect(warning).toHaveTextContent(
    'Changing or leaving this campaign may impact your character sheet.',
  );
  fireEvent.click(within(warning).getByRole('button', { name: 'Continue' }));
  const select = screen.getByRole('combobox', { name: 'campaign' });
  await screen.findByRole('option', { name: 'The Sapphire Coast' });
  return select;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CampaignAssignmentControl', () => {
  it('shows the local campaign as a link when read-only and keeps names available offline', async () => {
    await seed();
    const fetchMock = vi.fn().mockRejectedValue(new Error('Offline'));
    vi.stubGlobal('fetch', fetchMock);

    renderControl({ canWrite: false });

    const campaignLink = await screen.findByRole('link', {
      name: 'The Amber Marches and its Long Campaign Title',
    });
    expect(campaignLink).toHaveAttribute('href', `/campaigns/${FIRST_CAMPAIGN_ID}`);
    expect(screen.queryByRole('button', { name: 'Edit campaign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'campaign' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(campaignLink);
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      `/campaigns/${FIRST_CAMPAIGN_ID}`,
    );
  });

  it('requires both confirmations to move, and the second cancellation leaves the editor unchanged', async () => {
    await seed();
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: SECOND_CAMPAIGN_ID } });
    const confirmation = screen.getByRole('dialog', { name: 'Are you sure?' });
    expect(confirmation).toHaveTextContent('The Amber Marches and its Long Campaign Title');
    expect(confirmation).toHaveTextContent('The Sapphire Coast');
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Are you sure?' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'campaign' })).toHaveValue(FIRST_CAMPAIGN_ID);
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
  });

  it('queues a move only after Continue and the final confirmation', async () => {
    await seed();
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: SECOND_CAMPAIGN_ID } });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Are you sure?' })).getByRole('button', {
        name: 'Change campaign',
      }),
    );

    await waitFor(async () => {
      expect(await getLocalDb().outbox.toArray()).toEqual([
        expect.objectContaining({
          entityClass: 'character',
          entityId: CHARACTER_ID,
          fieldPath: 'campaignId',
          attemptedValue: SECOND_CAMPAIGN_ID,
          prevValue: FIRST_CAMPAIGN_ID,
          status: 'pending',
        }),
      ]);
      expect(await getLocalDb().characters.get(CHARACTER_ID)).toMatchObject({
        campaignId: SECOND_CAMPAIGN_ID,
      });
    });
    expect(screen.queryByRole('combobox', { name: 'campaign' })).not.toBeInTheDocument();
  });

  it('warns before a first assignment and confirms the new destination separately', async () => {
    await seed(null);
    renderControl({ campaignId: null });

    expect(screen.getByText('No campaign', { selector: 'span' })).toBeInTheDocument();
    const select = await openEditor();
    fireEvent.change(select, { target: { value: FIRST_CAMPAIGN_ID } });
    const confirmation = screen.getByRole('dialog', { name: 'Are you sure?' });
    expect(confirmation).toHaveTextContent('No campaign');
    expect(confirmation).toHaveTextContent('The Amber Marches and its Long Campaign Title');
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Change campaign' }));
    await waitFor(async () =>
      expect(await getLocalDb().outbox.toArray()).toEqual([
        expect.objectContaining({ fieldPath: 'campaignId', attemptedValue: FIRST_CAMPAIGN_ID }),
      ]),
    );
  });

  it('confirms leaving the campaign before queuing a null assignment', async () => {
    await seed();
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: '' } });
    const confirmation = screen.getByRole('dialog', { name: 'Are you sure?' });
    expect(confirmation).toHaveTextContent('to No campaign');
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Change campaign' }));
    await waitFor(async () =>
      expect(await getLocalDb().outbox.toArray()).toEqual([
        expect.objectContaining({ fieldPath: 'campaignId', attemptedValue: null }),
      ]),
    );
  });

  it('cancels the initial warning without opening the editor or queuing a patch', async () => {
    await seed();
    renderControl();

    fireEvent.click(editButton());
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Change character campaign?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );

    expect(screen.queryByRole('combobox', { name: 'campaign' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('link', {
        name: 'The Amber Marches and its Long Campaign Title',
      }),
    ).toBeVisible();
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
  });

  it('lets the user cancel editor mode without changing the link or queuing a patch', async () => {
    await seed();
    renderControl();

    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing campaign' }));

    expect(screen.queryByRole('combobox', { name: 'campaign' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('link', {
        name: 'The Amber Marches and its Long Campaign Title',
      }),
    ).toBeVisible();
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
  });

  it('does not open a confirmation when the current campaign is selected', async () => {
    await seed();
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: FIRST_CAMPAIGN_ID } });

    expect(screen.queryByRole('dialog', { name: 'Are you sure?' })).not.toBeInTheDocument();
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
  });

  it('invalidates the editor when the character context or write access changes', async () => {
    await seed();
    const view = renderControl();
    const select = await openEditor();
    fireEvent.change(select, { target: { value: SECOND_CAMPAIGN_ID } });
    const confirmation = screen.getByRole('dialog', { name: 'Are you sure?' }) as HTMLDialogElement;
    view.rerender(
      <MemoryRouter>
        <RouteProbe />
        <ToastProvider>
          <CampaignAssignmentControl
            characterId={OTHER_CHARACTER_ID}
            campaignId={FIRST_CAMPAIGN_ID}
            canWrite
          />
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(confirmation.open).toBe(false));
    expect(screen.queryByRole('combobox', { name: 'campaign' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Change character campaign?' })).toBeNull();
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);

    fireEvent.click(editButton());
    const viewDialog = screen.getByRole('dialog', {
      name: 'Change character campaign?',
    }) as HTMLDialogElement;
    view.rerender(
      <MemoryRouter>
        <RouteProbe />
        <ToastProvider>
          <CampaignAssignmentControl
            characterId={OTHER_CHARACTER_ID}
            campaignId={FIRST_CAMPAIGN_ID}
            canWrite={false}
          />
        </ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(viewDialog.open).toBe(false));
    expect(screen.queryByRole('button', { name: 'Edit campaign' })).not.toBeInTheDocument();
  });

  it('disables repeat confirmation and editor cancellation while the local queue transaction is pending', async () => {
    await seed();
    let finishEnqueue!: () => void;
    const enqueue = vi.spyOn(outbox, 'enqueueFieldPatch').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishEnqueue = resolve;
      }),
    );
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: SECOND_CAMPAIGN_ID } });
    const confirmation = screen.getByRole('dialog', { name: 'Are you sure?' });
    const confirm = within(confirmation).getByRole('button', { name: 'Change campaign' });
    fireEvent.click(confirm);
    await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel editing campaign' })).toBeDisabled();

    fireEvent.click(confirm);
    expect(enqueue).toHaveBeenCalledTimes(1);
    await act(async () => finishEnqueue());
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'campaign' })).not.toBeInTheDocument(),
    );
  });

  it('shows a toast and keeps the editor available when the local enqueue fails', async () => {
    await seed();
    vi.spyOn(outbox, 'enqueueFieldPatch').mockRejectedValueOnce(new Error('database unavailable'));
    renderControl();

    const select = await openEditor();
    fireEvent.change(select, { target: { value: SECOND_CAMPAIGN_ID } });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Are you sure?' })).getByRole('button', {
        name: 'Change campaign',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't change campaign — database unavailable",
    );
    expect(screen.getByRole('combobox', { name: 'campaign' })).toBeVisible();
    expect(await getLocalDb().outbox.toArray()).toHaveLength(0);
    expect(await getLocalDb().characters.get(CHARACTER_ID)).toMatchObject({
      campaignId: FIRST_CAMPAIGN_ID,
    });
  });

  it('flashes the campaign display after a sync rollback notification', async () => {
    await seed();
    renderControl();
    const display = await screen.findByText('The Amber Marches and its Long Campaign Title');
    const wrapper = display.closest('[data-flashing]');
    expect(wrapper).toHaveAttribute('data-flashing', 'false');

    act(() => {
      flashBus.emit({
        key: makeFlashKey('character', CHARACTER_ID, 'campaignId'),
        reason: 'rejected',
      });
    });
    expect(wrapper).toHaveAttribute('data-flashing', 'true');
  });
});
