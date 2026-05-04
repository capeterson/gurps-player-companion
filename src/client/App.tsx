import { useIsMutating } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { api } from './lib/api.ts';
import { tokenStore } from './lib/tokenStore.ts';

export function App() {
  const navigate = useNavigate();
  const isMutating = useIsMutating();

  function signOut() {
    const tokens = tokenStore.read();
    if (tokens) {
      // Best-effort: revoke the refresh token server-side so it can't be reused.
      api('/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
        authenticated: false,
      }).catch(() => {});
    }
    tokenStore.clear();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <header className="navbar bg-base-200 border-b border-base-300">
        <div className="flex-1 flex items-center gap-4 px-4">
          <Link to="/" className="font-display text-xl">
            GURPS Player Companion
          </Link>
          <nav className="flex gap-2">
            <Link to="/characters" className="btn btn-ghost btn-sm">
              Characters
            </Link>
          </nav>
        </div>
        <div className="flex-none flex items-center gap-3 px-4">
          {isMutating > 0 && (
            <span className="badge badge-primary badge-sm" aria-live="polite" aria-label="Saving">
              <span className="inline-block w-2 h-2 bg-current rounded-full animate-pulse mr-1" />
              saving · {isMutating}
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="container mx-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
