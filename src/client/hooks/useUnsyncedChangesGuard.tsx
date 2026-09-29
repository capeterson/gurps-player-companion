import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx';
import { getLocalDb } from '../db/dexie.ts';
import { getThemeState } from '../lib/theme.ts';
import { useToasts } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';

type Intent = 'signOut' | 'changePassword';
interface DiscardRequest {
  intent: Intent;
  sessionId: string | undefined;
  action: () => Promise<void>;
}

/** User-initiated session cleanup must never silently discard local intent. */
export function useUnsyncedChangesGuard() {
  const toasts = useToasts();
  const busy = useRef(false);
  const executing = useRef(false);
  const [request, setRequest] = useState<DiscardRequest | null>(null);
  const [performing, setPerforming] = useState(false);

  async function execute(next: DiscardRequest) {
    if (executing.current) return;
    executing.current = true;
    setPerforming(true);
    try {
      // A confirmation for an old login must not purge a new account's data.
      if (tokenStore.read()?.sessionId !== next.sessionId) {
        throw new Error('Your sign-in session changed. Please try again.');
      }
      await next.action();
    } catch (error) {
      toasts.push(error instanceof Error ? error.message : 'Could not finish this action', {
        kind: 'error',
      });
    } finally {
      busy.current = false;
      executing.current = false;
      setPerforming(false);
      setRequest(null);
    }
  }

  async function guard(intent: Intent, action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    const next = { intent, action, sessionId: tokenStore.read()?.sessionId };
    try {
      const db = getLocalDb();
      const hasUnsyncedChanges = await db.transaction(
        'r',
        [db.outbox, db.mediaUploads],
        async () => (await db.outbox.count()) > 0 || (await db.mediaUploads.count()) > 0,
      );
      if (hasUnsyncedChanges || getThemeState().pending) {
        setRequest(next);
      } else {
        await execute(next);
      }
    } catch {
      busy.current = false;
      toasts.push('Could not check unsaved changes. Please try again.', {
        kind: 'error',
      });
    }
  }

  function cancel() {
    if (performing) return;
    busy.current = false;
    setRequest(null);
  }

  const changingPassword = request?.intent === 'changePassword';
  const dialog = (
    <ConfirmDialog
      open={request !== null}
      title={
        changingPassword
          ? 'Discard unsaved changes and change password?'
          : 'Discard unsaved changes and sign out?'
      }
      confirmLabel={changingPassword ? 'Discard and change password' : 'Discard and sign out'}
      cancelLabel="Keep editing"
      tone="error"
      pending={performing}
      onCancel={cancel}
      onConfirm={() => {
        if (request) void execute(request);
      }}
    >
      <p>
        This device has changes that have not been saved to the server. Continuing permanently
        discards all unsynced edits and image files on this device.
      </p>
      <p className="mt-2">
        Keep editing to sync your changes first. Unsaved images can also be exported from the sync
        log.
      </p>
    </ConfirmDialog>
  );

  return { guard, dialog };
}
