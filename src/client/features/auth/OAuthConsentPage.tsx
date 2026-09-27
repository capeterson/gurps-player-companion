import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api.ts';

interface Details {
  clientName: string;
  scopes: Array<'gpc:read' | 'gpc:write' | 'gpc:manage'>;
  scopeDescriptions: Record<string, string>;
  csrfToken: string;
  state: string;
}

export function OAuthConsentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search;
  const returnTo = `${location.pathname}${search}`;
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const details = useQuery({
    queryKey: ['oauth-authorization', search],
    queryFn: () => api<Details>(`/oauth/authorization?${query.toString()}`),
    retry: false,
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ displayName: string; email: string }>('/auth/me'),
  });
  const decide = useMutation({
    mutationFn: async (decision: 'approve' | 'deny') => {
      if (!details.data) throw new Error('authorization details unavailable');
      const body = Object.fromEntries(query.entries());
      return api<{ redirectTo: string }>('/oauth/authorization', {
        method: 'POST',
        body: { ...body, csrf_token: details.data.csrfToken, decision },
      });
    },
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
    onError: (error) => {
      if (requiresRecentAuthentication(error)) {
        navigate('/login', {
          replace: true,
          state: { returnTo, reason: 'oauth-consent-reauthentication' },
        });
      }
    },
  });

  if (requiresRecentAuthentication(details.error)) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo, reason: 'oauth-consent-reauthentication' }}
      />
    );
  }

  return (
    <main className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
      <section className="card relative z-10 w-full max-w-lg space-y-5 p-card">
        <div>
          <p className="label-eyebrow">Connected app</p>
          <h1 className="font-display text-3xl">Authorize {details.data?.clientName ?? 'app'}</h1>
        </div>
        {details.isPending && <p>Checking this request…</p>}
        {details.isError && (
          <p className="alert alert-error">This authorization request is invalid or expired.</p>
        )}
        {details.data && (
          <>
            {me.data && (
              <p className="text-sm text-muted">
                Signed in as {me.data.displayName} ({me.data.email})
              </p>
            )}
            <p>This app is asking to act as you with these permissions:</p>
            <ul className="space-y-2">
              {details.data.scopes.map((scope) => (
                <li key={scope} className="rounded-box border border-base-300 p-3">
                  {details.data.scopeDescriptions[scope]}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">
              The app never receives your password, passkeys, app session, or API keys. You can
              revoke it from Settings.
            </p>
            {decide.isError && (
              <div className="alert alert-error text-sm">
                <span>
                  {decide.error instanceof Error ? decide.error.message : 'Authorization failed'}
                </span>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate('deny')}
              >
                Deny
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={decide.isPending}
                onClick={() => decide.mutate('approve')}
              >
                Authorize
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function requiresRecentAuthentication(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.message === 'recent authentication required'
  );
}
