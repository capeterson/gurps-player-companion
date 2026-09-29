import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '../db/dexie.ts';
import { api } from '../lib/api.ts';
import { clearPendingThemePreferences, getThemeState, setThemePreference } from '../lib/theme.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { tokenStore } from '../lib/tokenStore.ts';
import { useUnsyncedChangesGuard } from './useUnsyncedChangesGuard.tsx';

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: vi.fn().mockRejectedValue(new Error('offline')) };
});

const TOKENS = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  accessTokenExpiresIn: 900,
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  localStorage.clear();
  tokenStore.write(TOKENS);
});

afterEach(() => {
  vi.mocked(api).mockReset().mockRejectedValue(new Error('offline'));
  clearPendingThemePreferences();
});

function GuardHarness({
  onSignOut,
  onChangePassword,
}: {
  onSignOut: () => Promise<void>;
  onChangePassword: () => Promise<void>;
}) {
  const { guard, dialog } = useUnsyncedChangesGuard();
  return (
    <>
      <button type="button" onClick={() => void guard('signOut', onSignOut)}>
        Sign out
      </button>
      <button type="button" onClick={() => void guard('changePassword', onChangePassword)}>
        Change password
      </button>
      {dialog}
    </>
  );
}

function mount(onAction = vi.fn(async () => {})) {
  const onSignOut = vi.fn(onAction);
  const onChangePassword = vi.fn(onAction);
  render(
    <ToastProvider>
      <GuardHarness onSignOut={onSignOut} onChangePassword={onChangePassword} />
    </ToastProvider>,
  );
  return { onSignOut, onChangePassword };
}

async function addOutboxEntry(entityClass: 'character' | 'campaign_library_trait', status: string) {
  await getLocalDb().outbox.put({
    clientOpId: `${entityClass}-${status}`,
    entityClass,
    entityId: '0193b3c0-f1f0-7000-8000-00000000a100',
    command: 'patch',
    coalesceKey: '0193b3c0-f1f0-7000-8000-00000000a100|name',
    fieldPath: 'name',
    attemptedValue: 'Queued edit',
    prevValue: 'Before edit',
    validationVersion: 1,
    status: status as 'pending' | 'in_flight' | 'transient_retry',
    enqueuedAt: new Date().toISOString(),
    attemptCount: 0,
  });
}

async function addPendingImage() {
  await getLocalDb().mediaUploads.put({
    id: '0193b3c0-f1f0-7000-8000-00000000a200',
    userId: '0193b3c0-f1f0-7000-8000-00000000a201',
    targetType: 'character',
    targetId: '0193b3c0-f1f0-7000-8000-00000000a202',
    blob: new Blob(['unsynced portrait'], { type: 'image/png' }),
    byteLength: 17,
    sha256: 'test-digest',
    state: 'queued',
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
}

describe('useUnsyncedChangesGuard', () => {
  it.each(['pending', 'in_flight', 'transient_retry'] as const)(
    'asks before signing out when a character operation is %s',
    async (status) => {
      await addOutboxEntry('character', status);
      const { onSignOut } = mount();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

      expect(
        await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' }),
      ).toBeVisible();
      expect(onSignOut).not.toHaveBeenCalled();
      expect(tokenStore.read()?.refreshToken).toBe(TOKENS.refreshToken);
      expect(await getLocalDb().outbox.count()).toBe(1);
    },
  );

  it.each(['pending', 'in_flight', 'transient_retry'] as const)(
    'asks before changing password when a campaign library operation is %s',
    async (status) => {
      await addOutboxEntry('campaign_library_trait', status);
      const { onChangePassword } = mount();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Change password' }));

      expect(
        await screen.findByRole('dialog', { name: 'Discard unsaved changes and change password?' }),
      ).toBeVisible();
      expect(onChangePassword).not.toHaveBeenCalled();
      expect(await getLocalDb().outbox.count()).toBe(1);
    },
  );

  it('treats a queued image as unsynced work even when the outbox is empty', async () => {
    await addPendingImage();
    const { onSignOut } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' }),
    ).toBeVisible();
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(await getLocalDb().mediaUploads.count()).toBe(1);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('treats a pending theme preference as unsynced work', async () => {
    const current = getThemeState().preferences.darkTheme;
    setThemePreference('darkTheme', current === 'gilded-tome' ? 'arcane-dark' : 'gilded-tome');
    const { onSignOut } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' }),
    ).toBeVisible();
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(await getLocalDb().mediaUploads.count()).toBe(0);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('keeps tokens and queued rows when the user cancels', async () => {
    await addOutboxEntry('character', 'pending');
    await addPendingImage();
    const { onSignOut } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' });
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onSignOut).not.toHaveBeenCalled();
    expect(tokenStore.read()?.refreshToken).toBe(TOKENS.refreshToken);
    expect(await getLocalDb().outbox.count()).toBe(1);
    expect(await getLocalDb().mediaUploads.count()).toBe(1);
  });

  it('runs the confirmed action, which purges local rows and tokens', async () => {
    await addOutboxEntry('character', 'pending');
    await addPendingImage();
    const onSignOut = vi.fn(async () => {
      await getLocalDb().outbox.clear();
      await getLocalDb().mediaUploads.clear();
      tokenStore.clear();
    });
    mount(onSignOut);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Discard and sign out' }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(await getLocalDb().mediaUploads.count()).toBe(0);
    expect(tokenStore.read()).toBeNull();
  });

  it('executes immediately when there is no unsynced work', async () => {
    const { onSignOut } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks the action and displays an error if reading local state fails', async () => {
    const db = getLocalDb();
    vi.spyOn(db.outbox, 'count').mockRejectedValue(new Error('IndexedDB is unavailable'));
    const { onSignOut } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check unsaved changes. Please try again.',
    );
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tokenStore.read()?.refreshToken).toBe(TOKENS.refreshToken);
  });

  it('does not act on confirmation from an older session', async () => {
    await addOutboxEntry('character', 'pending');
    const { onSignOut } = mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' });
    tokenStore.write({
      accessToken: 'new-session-access',
      refreshToken: 'new-session-refresh',
      accessTokenExpiresIn: 900,
    });
    await user.click(screen.getByRole('button', { name: 'Discard and sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your sign-in session changed. Please try again.',
    );
    expect(onSignOut).not.toHaveBeenCalled();
    expect(await getLocalDb().outbox.count()).toBe(1);
    expect(tokenStore.read()?.refreshToken).toBe('new-session-refresh');
  });

  it('shows a failed action reason and leaves the session in place', async () => {
    const failedAction = vi.fn(async () => {
      throw new Error('Server could not revoke this session');
    });
    const { onSignOut } = mount(failedAction);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server could not revoke this session',
    );
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(tokenStore.read()?.refreshToken).toBe(TOKENS.refreshToken);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not run the password mutation until the visible discard confirmation', async () => {
    await addOutboxEntry('character', 'pending');
    const passwordMutation = vi.fn(async () => {});
    const { onChangePassword } = mount(passwordMutation);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Discard unsaved changes and change password?',
    });
    expect(dialog).toBeVisible();
    expect(onChangePassword).not.toHaveBeenCalled();
    expect(passwordMutation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard and change password' }));
    await waitFor(() => expect(passwordMutation).toHaveBeenCalledTimes(1));
  });

  it('ignores duplicate sign-out clicks while the unsynced check is opening the dialog', async () => {
    await addOutboxEntry('character', 'pending');
    const { onSignOut } = mount();
    const button = screen.getByRole('button', { name: 'Sign out' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(
      await screen.findByRole('dialog', { name: 'Discard unsaved changes and sign out?' }),
    ).toBeVisible();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await getLocalDb().outbox.count()).toBe(1);
  });
});
