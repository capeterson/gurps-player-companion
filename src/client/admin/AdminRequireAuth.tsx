import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { tokenStore } from '../lib/tokenStore.ts';

/** Admin uses HTTP queries and must never bootstrap the player's local data. */
export function AdminRequireAuth() {
  const location = useLocation();
  const [hasSession, setHasSession] = useState(() => tokenStore.hasToken());
  useEffect(() => {
    const unsubscribe = tokenStore.subscribe((snapshot) => setHasSession(snapshot !== null));
    // Catch a session change between rendering and attaching the listener.
    // Read storage here rather than in React's synchronous snapshot checks.
    setHasSession(tokenStore.hasToken());
    return unsubscribe;
  }, []);
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
