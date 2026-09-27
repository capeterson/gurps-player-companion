import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
import { NotificationsBell } from './NotificationsBell.tsx';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  dismiss: vi.fn(),
  markAllRead: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('../lib/notifications.ts', () => ({
  notificationsApi: {
    list: mocks.list,
    dismiss: mocks.dismiss,
    markAllRead: mocks.markAllRead,
  },
}));

vi.mock('../lib/invitations.ts', () => ({
  invitationsApi: { accept: mocks.accept, reject: mocks.reject },
}));

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NotificationsBell />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

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
