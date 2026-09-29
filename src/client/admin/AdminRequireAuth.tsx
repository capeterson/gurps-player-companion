import { useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { tokenStore } from '../lib/tokenStore.ts';

/** Admin uses HTTP queries and must never bootstrap the player's local data. */
export function AdminRequireAuth() {
  const location = useLocation();
  const hasSession = useSyncExternalStore(
    tokenStore.subscribe,
    () => tokenStore.hasToken(),
    () => false,
  );
  if (!hasSession) {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}
