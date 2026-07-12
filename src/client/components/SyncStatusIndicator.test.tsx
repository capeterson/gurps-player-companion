import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { syncStateStore } from '../sync/state.ts';
import { SyncStatusIndicator } from './SyncStatusIndicator.tsx';

const clearLocalAndFullResync = vi.fn<() => Promise<void>>();
const revertFailedOperation = vi.fn<(id: string) => Promise<OutboxEntry>>();

vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({ clearLocalAndFullResync, revertFailedOperation }),
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
  revertFailedOperation.mockReset();
  tokenStore.clear();
  syncStateStore.reset('synced');
});

describe('SyncStatusIndicator recovery action', () => {
  it('opens the sync log from the normal synced state', async () => {
    syncStateStore.reset('synced');
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('All changes saved'));
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /abandon local changes and re-sync/i }),
    ).toBeInTheDocument();
  });

  it('opens the sync log in the error state', async () => {
    syncStateStore.reset('error');
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('Some changes failed to sync'));
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
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

    await user.click(screen.getByLabelText('Some changes failed to sync'));
    await user.click(screen.getByRole('button', { name: /abandon local changes and re-sync/i }));
    expect(clearLocalAndFullResync).not.toHaveBeenCalled();
    expect(screen.getByText('Abandon local changes and re-sync?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /abandon and re-sync/i }));

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

    await user.click(screen.getByLabelText('Some changes failed to sync'));
    await user.click(screen.getByRole('button', { name: /abandon local changes and re-sync/i }));
    await user.click(screen.getByRole('button', { name: /abandon and re-sync/i }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't resync — cursor failed/)).toBeInTheDocument();
    });
  });

  it('puts a fourth-attempt failure first with folded diagnostics and a revert action', async () => {
    const failed: OutboxEntry = {
      clientOpId: 'failed-op',
      entityClass: 'character',
      entityId: 'character-1',
      command: 'patch',
      coalesceKey: 'character-1|name',
      fieldPath: 'name',
      attemptedValue: 'Unsaved name',
      prevValue: 'Server name',
      validationVersion: 1,
      status: 'transient_retry',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 4,
      serverReason: 'HTTP 503',
      lastError: { status: 503, body: { error: 'maintenance' } },
      humanName: 'Name',
    };
    await getLocalDb().outbox.put(failed);
    revertFailedOperation.mockResolvedValue(failed);
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('All changes saved'));
    expect(await screen.findByText('Repeatedly failing')).toBeInTheDocument();
    const details = screen.getByText('Debug information').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revert change' }));
    const confirmRevert = screen.getAllByRole('button', { name: 'Revert change' }).at(1);
    expect(confirmRevert).toBeDefined();
    if (confirmRevert) await user.click(confirmRevert);
    await waitFor(() => expect(revertFailedOperation).toHaveBeenCalledWith('failed-op'));
  });
});
