import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { syncStateStore } from '../sync/state.ts';
import { SyncStatusIndicator } from './SyncStatusIndicator.tsx';

const clearLocalAndFullResync = vi.fn<() => Promise<void>>();

vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ clearLocalAndFullResync }),
}));

vi.mock('../lib/localDbStatus.ts', () => ({
  formatBytes: (n: number) => `${n} B`,
  readLocalDbStatus: vi.fn().mockResolvedValue({
    indexedDbAvailable: true,
    storageUsageBytes: null,
    storageQuotaBytes: null,
  }),
}));

function jwtForUser(userId: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: userId })}.signature`;
}

function renderIndicator() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(<SyncStatusIndicator />, { wrapper: Wrapper });
}

afterEach(() => {
  clearLocalAndFullResync.mockReset();
  tokenStore.clear();
  syncStateStore.reset('synced');
});

describe('SyncStatusIndicator recovery action', () => {
  it('does not render the destructive reset button in the normal synced state', () => {
    syncStateStore.reset('synced');
    renderIndicator();

    expect(screen.getByLabelText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear local data and resync/i })).toBeNull();
  });

  it('renders the destructive reset option in the error state', () => {
    syncStateStore.reset('error');
    renderIndicator();

    expect(screen.getByText(/Some changes couldn't sync/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /clear local data and resync/i }),
    ).toBeInTheDocument();
  });

  it('requires confirmation before calling the recovery method', async () => {
    tokenStore.write({
      accessToken: jwtForUser('user-1'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    clearLocalAndFullResync.mockResolvedValue(undefined);
    syncStateStore.reset('error');
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByRole('button', { name: /clear local data and resync/i }));
    expect(clearLocalAndFullResync).not.toHaveBeenCalled();
    expect(screen.getByText('Clear local data and resync?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear and resync/i }));

    await waitFor(() => expect(clearLocalAndFullResync).toHaveBeenCalledWith('user-1'));
    expect(screen.getByText('Local data cleared and resynced')).toBeInTheDocument();
  });

  it('surfaces recovery failures as error toasts', async () => {
    tokenStore.write({
      accessToken: jwtForUser('user-2'),
      refreshToken: 'refresh',
      accessTokenExpiresIn: 0,
    });
    clearLocalAndFullResync.mockRejectedValue(new Error('cursor failed'));
    syncStateStore.reset('error');
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByRole('button', { name: /clear local data and resync/i }));
    await user.click(screen.getByRole('button', { name: /clear and resync/i }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't resync — cursor failed/)).toBeInTheDocument();
    });
  });
});
