import { Navigate, Outlet } from 'react-router-dom';
import { tokenStore } from '../lib/tokenStore.ts';

export function RequireAuth() {
  if (!tokenStore.hasToken()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
