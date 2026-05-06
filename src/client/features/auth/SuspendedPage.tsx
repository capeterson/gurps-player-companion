/**
 * Landing page for users whose account has been suspended (server
 * middleware returns 403 `{error: "suspended"}`). Reachable via direct
 * navigation OR by the api.ts interceptor that redirects on a suspended
 * 403.
 *
 * Renders generic "account disabled" copy and a sign-out button. We
 * deliberately don't try to fetch /auth/me here because suspended users
 * 403 the same call that brought them here — the UX is a dead-end by
 * design until an admin reactivates them.
 */

import { useNavigate } from 'react-router-dom';
import { tokenStore } from '../../lib/tokenStore.ts';

export function SuspendedPage() {
  const navigate = useNavigate();

  function signOut() {
    tokenStore.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="arcane-edge min-h-screen bg-base-200">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="card border border-base-300/60 bg-base-100 shadow-xl rounded-2xl">
          <div className="card-body p-8">
            <div className="label-eyebrow mb-2 text-error">Account disabled</div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-base-content">
              Your account has been suspended
            </h1>
            <p className="mt-3 text-sm text-base-content/60">
              While suspended, you cannot view characters, campaigns, or any other data on this
              instance. If you believe this is in error, contact the instance administrator.
            </p>
            <div className="mt-6 flex">
              <button type="button" onClick={signOut} className="btn btn-primary">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
