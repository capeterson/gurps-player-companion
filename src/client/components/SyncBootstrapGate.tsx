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
import { type ReactNode, useEffect, useState } from 'react';
import { getLocalDb } from '../db/dexie.ts';
import { api } from '../lib/api.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { getSyncOrchestrator } from '../sync/orchestrator.ts';

interface MeResponse {
  id: string;
}

export function SyncBootstrapGate({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);

  // Resolve the current user's id so we can key the per-account
  // bootstrap flag.  Fast path: any access token implies an active
  // session and /auth/me will return the id.
  useEffect(() => {
    const tokens = tokenStore.read();
    if (!tokens) {
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

  // Trigger the bootstrap once we know the user and it hasn't run yet.
  useEffect(() => {
    if (!userId || bootstrapped !== false) return;
    void getSyncOrchestrator().bootstrap(userId);
  }, [userId, bootstrapped]);

  // Block children until bootstrap is confirmed. Three sub-states:
  //   bootstrapped === undefined  liveQuery hasn't resolved yet (Dexie opening)
  //   bootstrapped === false      bootstrap needed; useEffect will start it
  //   bootstrapped === true       ready — render children
  //
  // Without the `undefined` case the gate would briefly render children
  // with an empty Dexie on first login, between the liveQuery settling
  // on `false` and the setBootstrapping(true) state update landing.
  if (userId && bootstrapped !== true) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
          <p className="text-sm text-base-content/70">Bringing local data in sync…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
