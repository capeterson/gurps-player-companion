import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
import { NotificationsBell } from './NotificationsBell.tsx';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  dismiss: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  api: vi.fn(),
}));

vi.mock('../lib/notifications.ts', () => ({
  notificationsApi: {
    list: mocks.list,
    dismiss: mocks.dismiss,
    markRead: mocks.markRead,
    markAllRead: mocks.markAllRead,
  },
}));

vi.mock('../lib/invitations.ts', () => ({
  invitationsApi: { accept: mocks.accept, reject: mocks.reject },
}));

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: mocks.api };
});

vi.mock('../lib/desktopNotifications.ts', () => ({
  useDesktopNotificationDelivery: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{`${location.pathname}${location.hash}`}</output>;
}

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.api.mockResolvedValue({ id: '0193b3c0-f1f0-7000-8000-000000000002' });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <NotificationsBell />
          <LocationProbe />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

const eventNotification = (overrides: Record<string, unknown> = {}) => ({
  id: '0193b3c0-f1f0-7000-8000-000000000011',
  userId: '0193b3c0-f1f0-7000-8000-000000000002',
  type: 'character_changed',
  payload: {
    topic: 'characterChanges',
    title: 'Mira updated',
    message: 'Alex updated Mira’s skills.',
    href: '/characters/0193b3c0-f1f0-7000-8000-000000000003#history',
    actorId: '0193b3c0-f1f0-7000-8000-000000000004',
    characterId: '0193b3c0-f1f0-7000-8000-000000000003',
    campaignId: null,
    changes: ['skills'],
  },
  relatedId: null,
  readAt: null,
  createdAt: '2026-09-28T12:00:00.000Z',
  ...overrides,
});

const campaignInvitation = (overrides: Record<string, unknown> = {}) => ({
  id: '0193b3c0-f1f0-7000-8000-000000000021',
  userId: '0193b3c0-f1f0-7000-8000-000000000002',
  type: 'campaign_invitation',
  payload: {
    campaign_id: '0193b3c0-f1f0-7000-8000-000000000022',
    campaign_name: 'The Amber Coast',
    inviter_id: '0193b3c0-f1f0-7000-8000-000000000004',
    inviter_display_name: 'Alex',
    role: 'member',
  },
  relatedId: '0193b3c0-f1f0-7000-8000-000000000023',
  readAt: null,
  actionable: true,
  createdAt: '2026-09-28T12:00:00.000Z',
  ...overrides,
});

describe('NotificationsBell untrusted invitation text', () => {
  it('renders inviter and campaign values as text, not markup', async () => {
    const inviter = `O'Brien & <img src=x onerror="alert(1)">`;
    const campaign = `Café & 東京 <svg onload="alert(2)"></svg>`;
    mocks.list.mockResolvedValueOnce([
      {
        id: '0193b3c0-f1f0-7000-8000-00000000e001',
        userId: '0193b3c0-f1f0-7000-8000-00000000e002',
        type: 'campaign_invitation',
        payload: {
          campaign_id: '0193b3c0-f1f0-7000-8000-00000000e003',
          campaign_name: campaign,
          inviter_id: '0193b3c0-f1f0-7000-8000-00000000e004',
          inviter_display_name: inviter,
          role: 'manager',
        },
        relatedId: '0193b3c0-f1f0-7000-8000-00000000e005',
        readAt: null,
        createdAt: '2026-09-27T00:00:00.000Z',
      },
    ]);
    const { container } = mount();

    const trigger = await screen.findByLabelText('Notifications (1 unread)');
    fireEvent.click(trigger);
    expect(trigger.closest('details')).toHaveAttribute('open');

    expect(await screen.findByText(inviter, { exact: true })).toBeVisible();
    expect(screen.getByText(campaign, { exact: true })).toBeVisible();
    expect(screen.getByText(/as a manager\./)).toBeVisible();
    expect(container.querySelector('img, svg[onload], script')).toBeNull();
  });
});

describe('NotificationsBell event and invitation actions', () => {
  it('shows typed event text and follows its valid internal history link', async () => {
    mocks.list.mockResolvedValue([eventNotification()]);
    mount();
    const bell = await screen.findByLabelText('Notifications (1 unread)');
    fireEvent.click(bell);
    expect(bell.closest('details')).toHaveAttribute('open');

    expect(await screen.findByText('Mira updated')).toBeVisible();
    expect(screen.getByText('Alex updated Mira’s skills.')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'View' }));
    expect(bell.closest('details')).not.toHaveAttribute('open');
    expect(await screen.findByTestId('current-location')).toHaveTextContent(
      '/characters/0193b3c0-f1f0-7000-8000-000000000003#history',
    );
    expect(mocks.markRead).toHaveBeenCalledWith('0193b3c0-f1f0-7000-8000-000000000011');
  });

  it('uses generic safe copy for an unknown or malformed notification payload', async () => {
    mocks.list.mockResolvedValue([
      eventNotification({
        type: 'future_event',
        payload: { campaign_name: 'Secret campaign', inviter_display_name: 'Alex' },
      }),
    ]);
    mount();
    fireEvent.click(await screen.findByLabelText('Notifications (1 unread)'));

    expect(
      await screen.findByText('A notification is available. Its details could not be displayed.'),
    ).toBeVisible();
    expect(screen.queryByText(/invited you to/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Secret campaign')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
  });

  it('keeps accept and decline available after a pending invitation is read', async () => {
    mocks.list.mockResolvedValue([campaignInvitation({ readAt: '2026-09-28T13:00:00.000Z' })]);
    mount();
    fireEvent.click(await screen.findByLabelText('Notifications'));

    expect(await screen.findByRole('button', { name: 'Accept' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
  });

  it('offers dismissal for a resolved unread invitation without stale accept or decline actions', async () => {
    mocks.list.mockResolvedValue([campaignInvitation({ actionable: false })]);
    mount();
    fireEvent.click(await screen.findByLabelText('Notifications (1 unread)'));

    expect(await screen.findByRole('button', { name: 'Mark read' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('marks and dismisses event notices through their visible controls', async () => {
    mocks.list.mockResolvedValue([eventNotification()]);
    mount();
    fireEvent.click(await screen.findByLabelText('Notifications (1 unread)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark read' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(mocks.markRead).toHaveBeenCalledWith('0193b3c0-f1f0-7000-8000-000000000011');
      expect(mocks.dismiss).toHaveBeenCalledWith('0193b3c0-f1f0-7000-8000-000000000011');
    });
  });

  it('surfaces accept and decline failures to the user', async () => {
    mocks.list.mockResolvedValue([campaignInvitation()]);
    mocks.accept.mockRejectedValue(new Error('invite expired'));
    mocks.reject.mockRejectedValue(new Error('server unavailable'));
    mount();
    fireEvent.click(await screen.findByLabelText('Notifications (1 unread)'));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Accept failed')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Reject failed')).toBeVisible();
  });
});
