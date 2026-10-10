import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';
import { connectionStore } from '../lib/connectionState.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { syncStateStore } from '../sync/state.ts';
import { SyncStatusIndicator } from './SyncStatusIndicator.tsx';

const clearLocalAndFullResync = vi.fn<() => Promise<void>>();
const revertFailedOperation = vi.fn<(id: string) => Promise<OutboxEntry>>();
const websocket = vi.hoisted(() => ({ state: 'stopped' }));
vi.mock('../sync/useSyncWsStatus.ts', () => ({ useSyncWsStatus: () => websocket }));

beforeEach(() => {
  websocket.state = 'stopped';
});

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  connectionStore.reset();
});

describe('SyncStatusIndicator recovery action', () => {
  it('shows a filled green gem when synced and the WebSocket is connected', async () => {
    websocket.state = 'connected';
    const user = userEvent.setup();
    const view = renderIndicator();
    const connected = screen.getByRole('button', {
      name: 'All changes saved — live updates connected',
    });
    expect(connected.querySelector('svg > path')).toHaveAttribute('fill', 'currentColor');
    expect(connected.querySelector('svg > path')).toHaveClass('text-success');
    await user.hover(connected);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Live updates connected');
    await user.click(connected);
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeVisible();

    for (const state of ['connecting', 'reconnecting', 'stopped', 'offline']) {
      websocket.state = state;
      view.rerender(<SyncStatusIndicator />);
      const idle = screen.getByRole('button', { name: 'All changes saved' });
      expect(idle.querySelector('svg > path')).toHaveAttribute('fill', 'none');
    }
  });

  it('keeps the connected gem green while syncing and removes the fill on disconnect', async () => {
    websocket.state = 'connected';
    const view = renderIndicator();
    syncStateStore.reset('syncing');
    const syncing = await screen.findByRole('button', { name: 'Syncing changes' });
    expect(syncing).toHaveClass('text-primary');
    expect(syncing.querySelector('svg > g')).toHaveClass('sync-symbol-orbit');
    expect(syncing.querySelector('svg > path')).toHaveAttribute('fill', 'currentColor');
    expect(syncing.querySelector('svg > path')).toHaveClass('text-success');

    websocket.state = 'reconnecting';
    view.rerender(<SyncStatusIndicator />);
    expect(syncing.querySelector('svg > path')).toHaveAttribute('fill', 'none');
    expect(syncing.querySelector('svg > path')).not.toHaveClass('text-success');
    expect(syncing.querySelector('svg > g')).toHaveClass('sync-symbol-orbit');

    websocket.state = 'connected';
    view.rerender(<SyncStatusIndicator />);
    expect(syncing.querySelector('svg > path')).toHaveAttribute('fill', 'currentColor');
    syncStateStore.reset('synced');
    const saved = await screen.findByRole('button', {
      name: 'All changes saved — live updates connected',
    });
    expect(saved.querySelector('svg > path')).toHaveClass('text-success');
    expect(saved.querySelector('svg > g')).not.toHaveClass('sync-symbol-orbit');
  });

  it('prioritizes offline and error symbols over a connected socket', async () => {
    websocket.state = 'connected';
    renderIndicator();
    syncStateStore.reset('syncing');
    expect(await screen.findByRole('button', { name: 'Syncing changes' })).toBeVisible();
    window.dispatchEvent(new Event('offline'));
    const offline = await screen.findByRole('button', {
      name: 'Offline — changes saved on this device',
    });
    expect(offline).toBeVisible();
    expect(offline.querySelector('svg > path')).not.toHaveClass('text-success');
    syncStateStore.setError('Server unavailable');
    const failed = await screen.findByRole('button', {
      name: 'Some changes failed to sync (offline)',
    });
    expect(failed).toBeVisible();
    expect(failed.querySelector('svg > path')).not.toHaveClass('text-success');
  });

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

  it('shows the paused status when going offline and resumes when going online', async () => {
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('All changes saved'));
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go offline' }));

    const paused = await screen.findByLabelText('Offline mode — sync paused');
    expect(paused).toBeVisible();
    expect(screen.getByText('Offline mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Go online' }));
    expect(await screen.findByLabelText('All changes saved')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  });

  it('keeps the current mode and explains when the offline preference cannot be saved', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    const user = userEvent.setup();
    renderIndicator();
    await user.click(screen.getByLabelText('All changes saved'));

    await user.click(screen.getByRole('button', { name: 'Go offline' }));

    expect(
      await screen.findByText("Couldn't change offline mode — storage full"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('All changes saved')).toBeInTheDocument();
  });

  it('opens the sync log in the error state', async () => {
    syncStateStore.reset('error');
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('Some changes failed to sync'));
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
  });

  it('disables destructive recovery while offline', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const user = userEvent.setup();
    renderIndicator();

    await user.click(screen.getByLabelText('Offline — changes saved on this device'));

    expect(
      screen.getByRole('button', { name: /abandon local changes and re-sync/i }),
    ).toBeDisabled();
    expect(screen.getByText(/Reconnect before abandoning local changes/i)).toBeInTheDocument();
    online.mockRestore();
  });

  it('transitions between synced, syncing, and the device-saved offline state', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    const user = userEvent.setup();
    renderIndicator();

    expect(screen.getByLabelText('All changes saved')).toBeInTheDocument();
    syncStateStore.reset('syncing');
    await waitFor(() => expect(screen.getByLabelText('Syncing changes')).toBeInTheDocument());

    window.dispatchEvent(new Event('offline'));
    await waitFor(() =>
      expect(screen.getByLabelText('Offline — changes saved on this device')).toBeInTheDocument(),
    );
    syncStateStore.reset('synced');
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(screen.getByLabelText('All changes saved')).toBeInTheDocument());

    // Keep the interaction exercised in this transition test: the offline
    // badge opens the same durable sync log as every other state.
    await user.click(screen.getByLabelText('All changes saved'));
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
    online.mockRestore();
  });

  it('keeps the failure reason visible when connectivity drops', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    syncStateStore.setError('Saving Notes failed');
    const user = userEvent.setup();
    renderIndicator();

    window.dispatchEvent(new Event('offline'));
    const indicator = await screen.findByLabelText('Some changes failed to sync (offline)');
    await user.hover(indicator);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Saving Notes failed');
    expect(tooltip).toHaveTextContent('Offline');
    expect(tooltip).toHaveClass(
      'max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))]',
    );
    await user.click(indicator);
    expect(screen.getByRole('heading', { name: 'Sync log' })).toBeInTheDocument();
    online.mockRestore();
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

  it('keeps a repeated network retry in the waiting list as Waiting for connection', async () => {
    const networkRetry: OutboxEntry = {
      clientOpId: 'offline-op',
      entityClass: 'character',
      entityId: 'character-1',
      command: 'patch',
      coalesceKey: 'character-1|name',
      fieldPath: 'name',
      attemptedValue: 'Offline edit',
      prevValue: 'Server name',
      validationVersion: 1,
      status: 'transient_retry',
      enqueuedAt: new Date().toISOString(),
      attemptCount: 4,
      serverReason: 'Failed to fetch',
      lastError: { name: 'TypeError', message: 'Failed to fetch' },
      humanName: 'Name',
    };
    await getLocalDb().outbox.put(networkRetry);
    renderIndicator();
    await userEvent.setup().click(screen.getByLabelText('All changes saved'));

    expect(await screen.findByText(/Waiting for connection/)).toBeInTheDocument();
    expect(screen.queryByText('Repeatedly failing')).not.toBeInTheDocument();
  });
});
