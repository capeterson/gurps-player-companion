import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { tokenStore } from '../lib/tokenStore.ts';

/** Authentication gate for security flows that must not wait for the local-data sync bootstrap. */
export function RequireSessionOnly() {
  const location = useLocation();
  if (!tokenStore.hasToken()) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}
