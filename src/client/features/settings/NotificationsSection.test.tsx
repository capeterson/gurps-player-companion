import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '../../../shared/schemas/notificationPreferences.ts';
import { ToastProvider } from '../../lib/toast.tsx';
import { NotificationsSection } from './NotificationsSection.tsx';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../../lib/api.ts', () => ({ api: mocks.api }));

import { api } from '../../lib/api.ts';

const userId = '0193b3c0-f1f0-7000-8000-000000000001';

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NotificationsSection userId={userId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {}

  onclick: ((this: Notification, ev: Event) => unknown) | null = null;
  close() {}
}

function installNotificationApi() {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  vi.stubGlobal('Notification', FakeNotification);
}

function mockPreferencesApi() {
  let saved = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  vi.mocked(api).mockImplementation(async (_path, options) => {
    if (options?.method === 'PATCH') {
      saved = { ...saved, ...(options.body as Partial<NotificationPreferences>) };
    }
    return saved as never;
  });
}

beforeEach(() => {
  localStorage.clear();
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockReset().mockResolvedValue('granted');
  installNotificationApi();
  vi.mocked(api).mockReset();
  mockPreferencesApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsSection', () => {
  it('shows explicit email and inbox controls with defaults, and never asks on mount', async () => {
    renderSection();

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Desktop notifications' })).not.toBeChecked();
    expect(await screen.findByRole('checkbox', { name: 'Campaign invitations' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Invitation accepted' })).toBeChecked();
    for (const label of [
      'Invitations',
      'Membership and access',
      'Changes to my characters',
      'Points awards',
      'Campaign rules and settings',
      'Shared adventure log',
      'Linked library updates',
    ]) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
    }
    expect(screen.getByText('Always on')).toBeVisible();
    expect(
      screen.getByText(/Password changes and passkey or API key changes always trigger an email/),
    ).toBeVisible();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /Disabled\. We will only ask for browser permission when you enable this setting\./,
      ),
    ).toBeVisible();
  });

  it('requests browser permission only after an explicit desktop toggle and saves per account on this browser', async () => {
    const user = userEvent.setup();
    renderSection();
    const desktop = await screen.findByRole('checkbox', { name: 'Desktop notifications' });

    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await user.click(desktop);

    await waitFor(() => expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(desktop).toBeChecked());
    expect(localStorage.getItem(`gpc:desktop-notifications:${userId}`)).toBe('true');
    expect(vi.mocked(api)).not.toHaveBeenCalledWith(
      '/auth/notification-preferences',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({ desktopEnabled: true }),
      }),
    );
  });

  it('renders browser-blocked state and does not repeat a denied permission request', async () => {
    FakeNotification.permission = 'denied';
    const user = userEvent.setup();
    renderSection();

    const desktop = await screen.findByRole('checkbox', { name: 'Desktop notifications' });
    expect(screen.getByText(/Blocked by your browser/)).toBeVisible();
    await user.click(desktop);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't save Desktop notifications/)).toBeVisible(),
    );
    expect(desktop).not.toBeChecked();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('persists topic choices through the server and flashes with a reason when a save fails', async () => {
    const user = userEvent.setup();
    renderSection();

    const invitations = await screen.findByRole('checkbox', { name: 'Invitations' });
    await user.click(invitations);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/notification-preferences', {
        method: 'PATCH',
        body: { invitations: false },
      }),
    );
    await waitFor(() => expect(invitations).not.toBeChecked());

    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') throw new Error('database unavailable');
      return DEFAULT_NOTIFICATION_PREFERENCES as never;
    });
    const membership = screen.getByRole('checkbox', { name: 'Membership and access' });
    await user.click(membership);
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't save Membership and access — database unavailable"),
      ).toBeVisible(),
    );
    await waitFor(() => expect(membership).toBeChecked());
    expect(membership).toHaveAttribute('data-flashing', 'true');
  });

  it('serializes same-topic toggles while saving another topic independently', async () => {
    const requests: Array<{
      body: Partial<NotificationPreferences>;
      resolve: (value: NotificationPreferences) => void;
    }> = [];
    vi.mocked(api).mockImplementation((_path, options) => {
      if (options?.method !== 'PATCH')
        return Promise.resolve(DEFAULT_NOTIFICATION_PREFERENCES as never);
      return new Promise((resolve) => {
        requests.push({
          body: options.body as Partial<NotificationPreferences>,
          resolve: (value) => resolve(value as never),
        });
      });
    });
    const user = userEvent.setup();
    renderSection();

    const invitations = await screen.findByRole('checkbox', { name: 'Invitations' });
    const points = screen.getByRole('checkbox', { name: 'Points awards' });
    await user.click(invitations);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(invitations);
    expect(requests).toHaveLength(1);
    await user.click(points);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(({ body }) => body)).toEqual([{ invitations: false }, { points: false }]);

    await act(async () => {
      requests[0]?.resolve({ ...DEFAULT_NOTIFICATION_PREFERENCES, invitations: false });
      requests[1]?.resolve({ ...DEFAULT_NOTIFICATION_PREFERENCES, points: false });
    });
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]?.body).toEqual({ invitations: true });
    await act(async () => {
      requests[2]?.resolve(DEFAULT_NOTIFICATION_PREFERENCES);
    });
    await waitFor(() => expect(invitations).toBeChecked());
    await waitFor(() => expect(points).not.toBeChecked());
  });
});
