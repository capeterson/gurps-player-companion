import { QueryClient, type QueryKey, hashKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { tokenStore } from './tokenStore.ts';

function sessionHash(queryKey: QueryKey): string {
  return hashKey(['session', tokenStore.read()?.sessionId ?? 'signed-out', queryKey]);
}

export function createSessionQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
        queryKeyHashFn: sessionHash,
      },
    },
  });
}

/** Cancel active work and synchronously remove every per-session query/mutation. */
export function clearSessionQueryCache(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}

/** Handles login, logout, recovery, refresh rejection, and changes made by another tab. */
export function SessionQueryCacheBoundary() {
  const queryClient = useQueryClient();
  const currentSession = useRef(tokenStore.read()?.sessionId ?? null);

  useEffect(
    () =>
      tokenStore.subscribe((next) => {
        const nextSession = next?.sessionId ?? null;
        if (nextSession === currentSession.current) return;
        currentSession.current = nextSession;
        clearSessionQueryCache(queryClient);
      }),
    [queryClient],
  );

  return null;
}
