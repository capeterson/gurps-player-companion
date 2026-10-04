/**
 * Blocks the UI on first login until the orchestrator has pulled an
 * initial snapshot from /sync/cursor into Dexie.  Without this gate
 * the user would briefly see "no characters" while the empty Dexie
 * stores get populated by the background sync.
 *
 * On subsequent renders (the `bootstrap:${userId}` flag exists in
 * `syncMeta`) the gate renders the children immediately and the
 * orchestrator does a normal cursor pull in the background.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getLocalDb } from '../db/dexie.ts';
import { useConnectionStatus } from '../hooks/useConnectionStatus.ts';
import { connectionStore } from '../lib/connectionState.ts';
import { api } from '../lib/api.ts';
import { readUserIdFromToken, tokenStore } from '../lib/tokenStore.ts';
import { isAccountMismatch, writeActiveUser } from '../sync/activeUser.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';
import { useSyncStatus } from '../sync/useSyncIndicatorState.ts';

interface MeResponse {
  id: string;
}

export function SyncBootstrapGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const hasSession = useSyncExternalStore(tokenStore.subscribe, () => tokenStore.hasToken());
  const { error: syncError } = useSyncStatus();
  const { online, manualOffline } = useConnectionStatus();
  const [retrying, setRetrying] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Seed userId synchronously from the stored JWT so the gate blocks
  // immediately on first render — before /auth/me has had a chance to
  // resolve.  Without this, userId starts as null while the fetch is
  // in-flight, causing the `userId && …` condition to short-circuit and
  // briefly render children with an empty Dexie on first login.
  const [userId, setUserId] = useState<string | null>(() => readUserIdFromToken());

  // Confirm the id server-side and pick up any change (e.g. a different
  // account logging in on the same device).  RequireAuth handles the
  // redirect if the token is invalid; we just keep the gate rendered.
  useEffect(() => {
    if (!tokenStore.read()) {
      setUserId(null);
      return;
    }
    let cancelled = false;
    void api<MeResponse>('/auth/me')
      .then((me) => {
        if (!cancelled) setUserId(me.id);
      })
      .catch(() => {
        /* RequireAuth will redirect; the gate just renders empty. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bootstrapped = useLiveQuery(
    async () => {
      if (!userId) return undefined;
      const row = await getLocalDb().syncMeta.get(`bootstrap:${userId}`);
      return Boolean(row);
    },
    [userId],
    undefined as boolean | undefined,
  );

  // Local Dexie belongs to a different account. Sign-out purges, but a
  // session can also end WITHOUT one -- a refresh-token rejection just
  // clears the tokens -- and if that other account was itself
  // bootstrapped, the flag below is already true and the gate would
  // render their characters, outbox and journal as this user's own.
  // Seeded synchronously so nothing paints before the purge.
  const [switching, setSwitching] = useState(() => (userId ? isAccountMismatch(userId) : false));

  // Tell the orchestrator who's signed in as soon as we know, on EVERY
  // mount. `bootstrap()` below runs only when the bootstrap flag is
  // absent, so on an ordinary reload it never fires -- and the
  // orchestrator would spend the whole session without a user id,
  // silently skipping the minimal-view share sweep and the lost-session
  // report.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      if (isAccountMismatch(userId)) {
        setSwitching(true);
        // Wipes every store, so the bootstrap flag goes with it and the
        // block below keeps the gate closed until a fresh pull lands.
        await getSyncOrchestrator().purge();
      }
      if (cancelled) return;
      writeActiveUser(userId);
      setSwitching(false);
      getSyncOrchestrator().setCurrentUser(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Trigger the bootstrap once we know the user and it hasn't run yet.
  useEffect(() => {
    if (!userId || switching || bootstrapped !== false) return;
    void getSyncOrchestrator()
      .bootstrap(userId)
      .catch((cause: unknown) => {
        setBootstrapError(cause instanceof Error ? cause.message : 'The initial download failed.');
      });
  }, [userId, bootstrapped, switching]);

  async function retry() {
    if (!userId || retrying) return;
    setRetrying(true);
    setBootstrapError(null);
    try {
      if (manualOffline) connectionStore.setManualOffline(false);
      await getSyncOrchestrator().bootstrap(userId);
    } catch (cause) {
      setBootstrapError(cause instanceof Error ? cause.message : 'The initial download failed.');
    } finally {
      setRetrying(false);
    }
  }

  // Block children until bootstrap is confirmed. Three sub-states:
  //   bootstrapped === undefined  liveQuery hasn't resolved yet (Dexie opening)
  //   bootstrapped === false      bootstrap needed; useEffect will start it
  //   bootstrapped === true       ready — render children
  //
  // Without the `undefined` case the gate would briefly render children
  // with an empty Dexie on first login, between the liveQuery settling
  // on `false` and the setBootstrapping(true) state update landing.
  if (userId && (switching || bootstrapped !== true)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 p-4 text-center">
          {!hasSession ? (
            <>
              <h1 className="font-display text-2xl">Sign in to finish loading</h1>
              <p>Your session ended before this device could download your data.</p>
              <Link
                className="btn"
                to="/login"
                state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
              >
                Sign in again
              </Link>
            </>
          ) : !online || syncError || bootstrapError ? (
            <>
              <h1 className="font-display text-2xl">Your data isn't ready on this device</h1>
              <p role="alert" className="break-words text-sm">
                {!online
                  ? 'Connect to the internet to finish the first download. Offline access is available after that download completes.'
                  : bootstrapError || syncError?.reason}
              </p>
              <button
                type="button"
                className="btn"
                disabled={(!online && !manualOffline) || retrying || switching}
                onClick={() => void retry()}
              >
                {retrying ? 'Retrying…' : manualOffline ? 'Go online' : 'Retry download'}
              </button>
            </>
          ) : (
            <>
              <span
                className="loading loading-spinner loading-lg text-primary"
                aria-hidden="true"
              />
              <p className="text-sm text-base-content/70">Bringing local data in sync…</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
