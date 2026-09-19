import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from '../auth/session.ts';

export interface TrustedExecutionContext {
  readonly user: AuthenticatedUser;
  readonly oauthClientDbId: string;
  readonly oauthClientId: string;
  readonly oauthGrantId: string;
  readonly scopes: readonly string[];
}

const requestActors = new WeakMap<Request, TrustedExecutionContext>();
const ambient = new AsyncLocalStorage<TrustedExecutionContext>();

/**
 * Mark a Request object created by the in-process operation executor. The
 * capability is the object identity itself: no header, URL, or body value can
 * cause an external request to enter this map.
 */
export function attachTrustedExecution(request: Request, context: TrustedExecutionContext): void {
  requestActors.set(request, context);
}

export function trustedExecutionFor(request: Request): TrustedExecutionContext | undefined {
  return requestActors.get(request);
}

export function runWithTrustedExecution<T>(
  context: TrustedExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return ambient.run(context, fn);
}

export function currentTrustedExecution(): TrustedExecutionContext | undefined {
  return ambient.getStore();
}
