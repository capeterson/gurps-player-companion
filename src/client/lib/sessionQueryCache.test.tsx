import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';
import { SessionQueryCacheBoundary, createSessionQueryClient } from './sessionQueryCache.tsx';
import { tokenStore } from './tokenStore.ts';

function login(accessToken: string, refreshToken: string): void {
  tokenStore.write({ accessToken, refreshToken, accessTokenExpiresIn: 3600 });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  tokenStore.clear();
});

describe('session-scoped TanStack Query cache', () => {
  it('clears query and mutation state synchronously when the login session changes', async () => {
    login('account-a', 'refresh-a');
    const client = createSessionQueryClient();
    client.setQueryData(['campaigns'], [{ id: 'private-a' }]);
    client.getMutationCache().build(client, {
      mutationKey: ['private-mutation'],
      mutationFn: async () => undefined,
    });

    render(
      <QueryClientProvider client={client}>
        <SessionQueryCacheBoundary />
      </QueryClientProvider>,
    );
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    tokenStore.clear();
    login('account-b', 'refresh-b');

    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('cannot cache a successful old-account response released after account switching', async () => {
    login('account-a', 'refresh-a');
    const client = createSessionQueryClient();
    render(
      <QueryClientProvider client={client}>
        <SessionQueryCacheBoundary />
      </QueryClientProvider>,
    );

    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => held),
    );
    const pending = client.fetchQuery({
      queryKey: ['campaigns', 'private'],
      queryFn: () => api('/campaigns'),
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    tokenStore.clear();
    login('account-b', 'refresh-b');
    release(
      new Response(JSON.stringify([{ id: 'private-a' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(pending).rejects.toThrow();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
