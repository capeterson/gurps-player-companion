import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api.ts';
import { ConnectedAppsSection } from './ConnectedAppsSection.tsx';

const push = vi.hoisted(() => vi.fn());
vi.mock('../../lib/toast.tsx', () => ({ useToasts: () => ({ push }) }));
vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
const grant = {
  id: 'grant-1',
  clientId: 'helper',
  clientName: 'Campaign Helper',
  scopes: ['gpc:read'],
  createdAt: '2026-09-12T00:00:00.000Z',
  lastUsedAt: null,
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ConnectedAppsSection />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());

describe('connected apps', () => {
  it('revokes the selected grant, refreshes the list, and confirms completion', async () => {
    let revoked = false;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === 'DELETE') {
        revoked = true;
        return undefined as never;
      }
      return (revoked ? [] : [grant]) as never;
    });
    mount();
    await screen.findByText('Campaign Helper');
    expect(screen.getByText(/keep working after you sign out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke connected app?' });
    expect(api).not.toHaveBeenCalledWith('/oauth/grants/grant-1', { method: 'DELETE' });
    expect(dialog).toHaveTextContent('Campaign Helper');
    expect(dialog).toHaveTextContent('invalidates all of its access and refresh tokens');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await screen.findByText('No connected apps.');
    expect(api).toHaveBeenCalledWith('/oauth/grants/grant-1', { method: 'DELETE' });
    expect(push).toHaveBeenCalledWith('Connected app revoked', { kind: 'success' });
  });

  it('leaves the grant connected when revocation is cancelled', async () => {
    vi.mocked(api).mockResolvedValue([grant] as never);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke connected app?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog).not.toBeVisible());
    expect(screen.getByLabelText('Scopes for Campaign Helper')).toBeVisible();
    expect(api).not.toHaveBeenCalledWith('/oauth/grants/grant-1', { method: 'DELETE' });
  });

  it('keeps the grant visible and surfaces a failed revocation', async () => {
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === 'DELETE') throw new ApiError(503, 'Service unavailable');
      return [grant] as never;
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke connected app?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("Couldn't revoke connected app — Service unavailable", {
        kind: 'error',
      }),
    );
    expect(screen.getByLabelText('Scopes for Campaign Helper')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Revoke' })).not.toBeDisabled();
  });
});
