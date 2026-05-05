import { Navigate, Outlet } from 'react-router-dom';
import { SyncBootstrapGate } from '../components/SyncBootstrapGate.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { SyncProvider } from '../sync/SyncProvider.tsx';

export function RequireAuth() {
  if (!tokenStore.hasToken()) {
    return <Navigate to="/login" replace />;
  }
  // Wrap the authenticated tree in SyncProvider (starts the
  // orchestrator + bridges persistent rejection toasts) and
  // SyncBootstrapGate (blocks the UI until the first /sync/cursor
  // pull lands so the user doesn't see an empty Dexie).
  return (
    <SyncProvider>
      <SyncBootstrapGate>
        <Outlet />
      </SyncBootstrapGate>
    </SyncProvider>
  );
}
