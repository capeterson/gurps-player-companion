import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncBootstrapGate } from './SyncBootstrapGate.tsx';

const mocks = vi.hoisted(() => {
  let session = true;
  let bootstrapped = false;
  const listeners = new Set<() => void>();
  return {
    get session() {
      return session;
    },
    setSession(value: boolean) {
      session = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasToken: () => session,
    read: () => (session ? 'access-token' : null),
    setBootstrapped(value: boolean) {
      bootstrapped = value;
    },
    liveQuery: vi.fn(() => bootstrapped),
    bootstrap: vi.fn<(...args: unknown[]) => Promise<void>>(),
    setCurrentUser: vi.fn(),
    purge: vi.fn(),
    api: vi.fn(),
    accountMismatch: vi.fn(() => false),
    writeActiveUser: vi.fn(),
  };
});

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: mocks.liveQuery }));
vi.mock('../db/dexie.ts', () => ({ getLocalDb: vi.fn() }));
vi.mock('../lib/api.ts', () => ({ api: mocks.api }));
vi.mock('../lib/tokenStore.ts', () => ({
  readUserIdFromToken: () => 'user-1',
  tokenStore: {
    subscribe: mocks.subscribe,
    hasToken: mocks.hasToken,
    read: mocks.read,
  },
}));
vi.mock('../sync/activeUser.ts', () => ({
  isAccountMismatch: mocks.accountMismatch,
  writeActiveUser: mocks.writeActiveUser,
}));
vi.mock('../sync/orchestrator.ts', () => ({
  getSyncOrchestrator: () => ({
    bootstrap: mocks.bootstrap,
    setCurrentUser: mocks.setCurrentUser,
    purge: mocks.purge,
  }),
}));
vi.mock('../sync/useSyncIndicatorState.ts', () => ({ useSyncStatus: () => ({ error: null }) }));

function LocationState() {
  const location = useLocation();
  return <output aria-label="Location state">{JSON.stringify(location.state ?? {})}</output>;
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/characters/hero?tab=skills#magic']}>
      <LocationState />
      <SyncBootstrapGate>
        <h1>Character sheet</h1>
      </SyncBootstrapGate>
    </MemoryRouter>,
  );
}

describe('SyncBootstrapGate', () => {
  beforeEach(() => {
    mocks.setSession(true);
    mocks.setBootstrapped(false);
    mocks.bootstrap.mockReset().mockResolvedValue(undefined);
    mocks.setCurrentUser.mockClear();
    mocks.purge.mockClear();
    mocks.api.mockReset().mockResolvedValue({ id: 'user-1' });
    mocks.accountMismatch.mockReturnValue(false);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('offers sign-in again with the full route when the session expires mid-bootstrap', async () => {
    mocks.bootstrap.mockReturnValue(new Promise<void>(() => {}));
    renderGate();
    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledWith('user-1'));

    act(() => mocks.setSession(false));

    fireEvent.click(await screen.findByRole('link', { name: 'Sign in again' }));
    expect(await screen.findByLabelText('Location state')).toHaveTextContent(
      JSON.stringify({ returnTo: '/characters/hero?tab=skills#magic' }),
    );
  });

  it('shows the initial download error and releases children after a successful retry', async () => {
    mocks.bootstrap
      .mockRejectedValueOnce(new Error('Cursor request failed'))
      .mockImplementationOnce(async () => mocks.setBootstrapped(true));
    renderGate();

    expect(await screen.findByRole('alert')).toHaveTextContent('Cursor request failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));

    expect(await screen.findByRole('heading', { name: 'Character sheet' })).toBeInTheDocument();
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
  });

  it('explains that the first download needs a connection and disables retry offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.bootstrap.mockReturnValue(new Promise<void>(() => {}));
    renderGate();

    expect(await screen.findByRole('alert')).toHaveTextContent(/connect to the internet/i);
    expect(screen.getByRole('button', { name: 'Retry download' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Character sheet' })).not.toBeInTheDocument();
  });

  it('renders already-bootstrapped pages without starting another first pull', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mocks.setBootstrapped(true);
    renderGate();

    expect(await screen.findByRole('heading', { name: 'Character sheet' })).toBeInTheDocument();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
});
