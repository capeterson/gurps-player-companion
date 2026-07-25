/**
 * Which account the local Dexie currently belongs to.
 *
 * Sign-out purges Dexie, so account switching through the UI is safe.
 * But a session can also end *without* a purge — a refresh-token
 * rejection just clears the tokens (see `refreshTokens` in lib/api.ts).
 * Signing in as a different account after that leaves the previous
 * user's characters, outbox and journal in place, and every local
 * surface — the sheet, the sync dialog, the debug dump — would render
 * them as the new user's own. Worse, the share-gate snapshot is derived
 * from those same stale character rows, so they look present and
 * unmasked, i.e. fully accessible.
 *
 * Stored in localStorage rather than Dexie so the bootstrap gate can
 * read it **synchronously** on first render and block before anything
 * paints.
 */

const ACTIVE_USER_KEY = 'gpc.activeUser';

export function readActiveUser(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_USER_KEY);
}

export function writeActiveUser(userId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_USER_KEY, userId);
}

export function clearActiveUser(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_USER_KEY);
}

/**
 * True when local data belongs to a *different* account than the one
 * now signed in.  A null stored value means "no local data claimed yet"
 * (fresh install, or a purge already ran) and is never a mismatch.
 */
export function isAccountMismatch(userId: string): boolean {
  const active = readActiveUser();
  return active !== null && active !== userId;
}
