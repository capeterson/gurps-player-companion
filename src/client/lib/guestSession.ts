/**
 * Read-only guest preview session. The server allows a guest token only on its
 * read allow-list; the client additionally refuses every write locally, so a
 * control that slips through the read-only UI fails before reaching the outbox
 * or the network.
 */

import { useSyncExternalStore } from 'react';
import { guestSession } from '../../shared/schemas/auth.ts';
import { type TokenSnapshot, tokenStore } from './tokenStore.ts';

export const GUEST_READ_ONLY_MESSAGE =
  'The preview is read-only. Create an account to make changes.';

export class GuestReadOnlyError extends Error {
  constructor() {
    super(GUEST_READ_ONLY_MESSAGE);
    this.name = 'GuestReadOnlyError';
  }
}

export function isGuestSnapshot(snapshot: TokenSnapshot | null): boolean {
  return Boolean(snapshot?.guest);
}

export function isGuestSession(): boolean {
  return isGuestSnapshot(tokenStore.read());
}

/** Call before any local or server write. */
export function assertWritableSession(): void {
  if (isGuestSession()) throw new GuestReadOnlyError();
}

/** The preview campaign recorded when the guest session started. */
export function guestCampaignId(): string | null {
  return tokenStore.read()?.guest?.campaignId ?? null;
}

function subscribe(listener: () => void): () => void {
  const unsubscribe = tokenStore.subscribe(listener);
  return () => {
    unsubscribe();
  };
}

export function useIsGuestSession(): boolean {
  return useSyncExternalStore(subscribe, isGuestSession, () => false);
}

export class GuestPreviewUnavailableError extends Error {
  constructor(readonly status: number) {
    super(
      status === 429
        ? 'Too many previews started from this connection. Try again in a few minutes.'
        : 'The preview is not available right now.',
    );
    this.name = 'GuestPreviewUnavailableError';
  }
}

/**
 * Requests a guest token without credentials. Uses plain fetch: the shared API
 * client would attach and try to refresh the very session being replaced.
 */
export async function requestGuestToken() {
  const response = await fetch('/api/v1/auth/guest', { method: 'POST' });
  if (!response.ok) throw new GuestPreviewUnavailableError(response.status);
  return guestSession.parse(await response.json());
}

/** Begins a preview session; any signed-in session must have ended first. */
export async function startGuestSession(): Promise<string> {
  const session = await requestGuestToken();
  tokenStore.write({
    accessToken: session.accessToken,
    refreshToken: '',
    accessTokenExpiresIn: session.accessTokenExpiresIn,
    guest: { campaignId: session.campaignId },
  });
  return session.campaignId;
}
