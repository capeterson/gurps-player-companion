import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api.ts';
import { OAuthConsentPage } from './OAuthConsentPage.tsx';

vi.mock('../../lib/api.ts', async (original) => ({
  ...(await original<typeof import('../../lib/api.ts')>()),
  api: vi.fn(),
}));
const search = '?client_id=helper&state=state-123&scope=gpc%3Aread';
const details = {
  clientName: 'Campaign Helper',
  scopes: ['gpc:read'],
  scopeDescriptions: { 'gpc:read': 'Read your characters and campaign content.' },
  csrfToken: 'csrf-from-server',
  state: 'state-123',
};
function LoginTarget() {
  const location = useLocation();
  return <div>Login return: {(location.state as { returnTo: string }).returnTo}</div>;
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/oauth/consent']}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsentPage />} />
          <Route path="/login" element={<LoginTarget />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function configure(decide: () => Promise<unknown>) {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return (await decide()) as never;
    if (path === '/auth/me') return { displayName: 'Ada', email: 'ada@example.com' } as never;
    return details as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', `/oauth/consent${search}`);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('OAuth consent', () => {
  for (const decision of ['approve', 'deny'] as const) {
    it(`shows the player and permissions and submits an explicit ${decision} with the CSRF binding`, async () => {
      const redirect = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
      configure(async () => ({ redirectTo: `https://client.example/callback?${decision}` }));
      mount();
      await screen.findByText('Read your characters and campaign content.');
      expect(screen.getByText(/Signed in as Ada/)).toHaveTextContent('ada@example.com');
      fireEvent.click(
        screen.getByRole('button', { name: decision === 'approve' ? 'Authorize' : 'Deny' }),
      );
      await waitFor(() =>
        expect(redirect).toHaveBeenCalledWith(`https://client.example/callback?${decision}`),
      );
      expect(api).toHaveBeenCalledWith('/oauth/authorization', {
        method: 'POST',
        body: {
          client_id: 'helper',
          state: 'state-123',
          scope: 'gpc:read',
          csrf_token: 'csrf-from-server',
          decision,
        },
      });
    });
  }

  it('disables both choices while a decision is pending and retains the request after a failure', async () => {
    let rejectDecision: (error: Error) => void = () => {
      throw new Error('decision did not start');
    };
    configure(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecision = reject;
        }),
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    rejectDecision(new ApiError(503, 'Service temporarily unavailable'));
    await screen.findByText('Service temporarily unavailable');
    expect(screen.getByText('Read your characters and campaign content.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Authorize' })).not.toBeDisabled();
  });

  it('offers reauthentication with the complete consent return path', async () => {
    configure(async () => {
      throw new ApiError(403, 'recent authentication required');
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in again to continue' }));
    expect(await screen.findByText(`Login return: /oauth/consent${search}`)).toBeInTheDocument();
  });

  it('never offers approval for invalid consent details', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(400, 'invalid request'));
    mount();
    await screen.findByText('This authorization request is invalid or expired.');
    expect(screen.queryByRole('button', { name: 'Authorize' })).not.toBeInTheDocument();
  });
});
