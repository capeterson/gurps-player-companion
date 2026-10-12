/**
 * `/preview`: starts a read-only guest session and opens the preview campaign.
 * A signed-in visitor keeps their own session and goes home instead.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { GuestPreviewUnavailableError, startGuestSession } from '../../lib/guestSession.ts';
import { tokenStore } from '../../lib/tokenStore.ts';

let pendingStart: Promise<string> | null = null;

/** One request even when React re-runs the effect (StrictMode, fast remounts). */
function startOnce(): Promise<string> {
  pendingStart ??= startGuestSession().finally(() => {
    pendingStart = null;
  });
  return pendingStart;
}

export function PreviewEntryPage() {
  const navigate = useNavigate();
  const existing = tokenStore.read();
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    setError(null);
    startOnce().then(
      (campaignId) => navigate(`/campaigns/${campaignId}`, { replace: true }),
      (cause: unknown) =>
        setError(
          cause instanceof GuestPreviewUnavailableError
            ? cause.message
            : 'The preview could not be reached. Check your connection and try again.',
        ),
    );
  }, [navigate]);

  useEffect(() => {
    if (!existing) start();
  }, [existing, start]);

  if (existing?.guest) return <Navigate to={`/campaigns/${existing.guest.campaignId}`} replace />;
  if (existing) return <Navigate to="/" replace />;

  return (
    <div className="arcane-edge min-h-dvh bg-base-200">
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
        {error ? (
          <div className="card border border-base-300/60 bg-base-100 shadow-xl">
            <div className="card-body gap-4">
              <h1 className="font-display text-2xl font-semibold">Preview unavailable</h1>
              <p role="alert" className="text-base-content/75">
                {error}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={start}>
                  Try again
                </button>
                <Link to="/" className="btn btn-ghost">
                  Back
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <output className="flex flex-col items-center gap-4" aria-label="Opening the preview">
            <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
            <span className="text-base-content/75">Opening the Lantern Coast…</span>
          </output>
        )}
      </main>
    </div>
  );
}
