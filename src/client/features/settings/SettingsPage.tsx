import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { createPasskey, passkeysSupported } from '../../lib/passkeys.ts';
import { useToasts } from '../../lib/toast.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';

export function SettingsPage() {
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () =>
      api<Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>>(
        '/auth/passkeys',
      ),
  });

  const addPasskey = useMutation({
    mutationFn: async () => {
      if (!passkeysSupported()) throw new Error('Passkeys are not supported by this browser');
      const options = await api<PublicKeyCredentialCreationOptions>(
        '/auth/passkeys/register/options',
        { method: 'POST' },
      );
      const credential = await createPasskey(options);
      return api('/auth/passkeys/register', { method: 'POST', body: credential });
    },
    onSuccess: () => {
      toasts.push('Passkey added', { kind: 'success' });
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
    onError: (err) => {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'passkey setup failed';
      toasts.push(`Couldn't add passkey — ${message}`, { kind: 'error' });
    },
  });

  const deletePasskey = useMutation({
    mutationFn: (id: string) => api(`/auth/passkeys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toasts.push('Passkey removed', { kind: 'success' });
      queryClient.invalidateQueries({ queryKey: ['passkeys'] });
    },
    onError: (err) => {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'passkey removal failed';
      toasts.push(`Couldn't remove passkey — ${message}`, { kind: 'error' });
    },
  });

  const changePassword = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
      return api<void>('/auth/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      toasts.push('Password changed', { kind: 'success' });
    },
    onError: (err) => {
      const message =
        err instanceof ApiError || err instanceof Error ? err.message : 'password change failed';
      setError(message);
      toasts.push(`Couldn't change password — ${message}`, { kind: 'error' });
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="label-eyebrow">Account</p>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="max-w-2xl text-sm text-muted">Manage your sign-in credentials.</p>
      </header>

      <section className="max-w-lg">
        <form
          className="card gap-4 p-card"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            changePassword.mutate();
          }}
        >
          <div>
            <p className="label-eyebrow">Security</p>
            <h2 className="font-display text-2xl">Change password</h2>
          </div>
          <label className="form-control flex flex-col gap-1">
            <span className="label-text">Current password</span>
            <input
              type="password"
              className="input input-bordered w-full max-w-md"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="form-control flex flex-col gap-1">
            <span className="label-text">New password</span>
            <input
              type="password"
              className="input input-bordered w-full max-w-md"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="form-control flex flex-col gap-1">
            <span className="label-text">Confirm new password</span>
            <input
              type="password"
              className="input input-bordered w-full max-w-md"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && <p className="text-sm text-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary w-fit"
            disabled={changePassword.isPending}
          >
            {changePassword.isPending ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="max-w-lg">
        <div className="card gap-4 p-card">
          <div>
            <p className="label-eyebrow">Security</p>
            <h2 className="font-display text-2xl">Passkeys</h2>
            <p className="text-sm text-muted">
              Add a passkey for optional passwordless sign-in on supported devices.
            </p>
          </div>
          {!passkeysSupported() && (
            <p className="alert alert-warning text-sm">This browser does not support passkeys.</p>
          )}
          <button
            type="button"
            className="btn btn-secondary w-fit"
            disabled={addPasskey.isPending || !passkeysSupported()}
            onClick={() => addPasskey.mutate()}
          >
            {addPasskey.isPending ? 'Creating passkey…' : 'Add passkey'}
          </button>
          <div className="space-y-2">
            {passkeys.data?.length === 0 && <p className="text-sm text-muted">No passkeys yet.</p>}
            {passkeys.data?.map((passkey) => (
              <div
                key={passkey.id}
                className="flex items-center justify-between gap-3 rounded-box border border-base-300 p-3"
              >
                <div>
                  <p className="font-medium">{passkey.name}</p>
                  <p className="text-xs text-muted">
                    Added {new Date(passkey.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error"
                  disabled={deletePasskey.isPending}
                  onClick={() => deletePasskey.mutate(passkey.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ApiKeysSection />
    </div>
  );
}
