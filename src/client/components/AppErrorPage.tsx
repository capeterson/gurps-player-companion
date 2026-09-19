import { useEffect, useState } from 'react';
import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import { ApiError } from '../lib/api.ts';
import { readUserIdFromToken } from '../lib/tokenStore.ts';

function newErrorReference(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `gpcerr_${id}`;
}

function serverRequestId(error: unknown): string | null {
  if (error instanceof ApiError) return error.requestId ?? null;
  if (!isRouteErrorResponse(error) || typeof error.data !== 'object' || error.data === null) {
    return null;
  }
  const value = (error.data as Record<string, unknown>).requestId;
  return typeof value === 'string' ? value : null;
}

function errorStatus(error: unknown): number | null {
  if (error instanceof ApiError || isRouteErrorResponse(error)) return error.status;
  return null;
}

export function AppErrorPage({ homeHref = '/' }: { homeHref?: string }) {
  const error = useRouteError();
  const location = useLocation();
  const [errorReference] = useState(newErrorReference);
  const [occurredAt] = useState(() => new Date().toISOString());
  const requestId = serverRequestId(error);
  const status = errorStatus(error);
  const userId = readUserIdFromToken();
  const path = location.pathname;
  const notFound = status === 404;

  useEffect(() => {
    console.error(
      'client route error',
      { errorReference, requestId, userId, status, path, occurredAt },
      error,
    );
  }, [error, errorReference, occurredAt, path, requestId, status, userId]);

  return (
    <main className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-4 text-base-content sm:p-8">
      <section
        className="card relative z-10 w-full max-w-2xl overflow-hidden border border-base-300 bg-base-100 shadow-arcane-lg"
        role="alert"
      >
        <div className="border-b border-base-300 bg-base-200/50 px-5 py-4 sm:px-7">
          <a href={homeHref} className="flex w-fit items-center gap-3 no-cap">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary font-display text-lg font-bold text-primary-content"
            >
              G
            </span>
            <span className="font-display font-semibold">Player Companion</span>
          </a>
        </div>

        <div className="space-y-6 p-5 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-box border border-error/40 bg-error/10 font-display text-xl text-error"
            >
              {notFound ? '404' : '!'}
            </div>
            <div className="min-w-0">
              <p className="label-eyebrow">Something went astray</p>
              <h1 className="font-display text-2xl sm:text-3xl">
                {notFound ? 'Page not found' : 'The app hit an unexpected error'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                {notFound
                  ? 'This page does not exist, or its address is out of date.'
                  : 'Reload and try again. If the problem continues, share the diagnostic details below.'}
              </p>
            </div>
          </div>

          <div className="rounded-box border border-base-300 bg-base-200/60 p-4">
            <p className="label-eyebrow mb-3">Diagnostic details</p>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <dt className="text-muted">Error reference</dt>
              <dd className="break-all font-mono text-xs sm:text-sm">{errorReference}</dd>
              {requestId && (
                <>
                  <dt className="text-muted">Server request ID</dt>
                  <dd className="break-all font-mono text-xs sm:text-sm">{requestId}</dd>
                </>
              )}
              {userId && (
                <>
                  <dt className="text-muted">User ID</dt>
                  <dd className="break-all font-mono text-xs sm:text-sm">{userId}</dd>
                </>
              )}
              <dt className="text-muted">Path</dt>
              <dd className="break-all font-mono text-xs sm:text-sm">{path}</dd>
              <dt className="text-muted">Time</dt>
              <dd className="break-all font-mono text-xs sm:text-sm">{occurredAt}</dd>
            </dl>
          </div>

          <div className="flex flex-wrap gap-3">
            <a href={homeHref} className="btn btn-primary">
              Return home
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
