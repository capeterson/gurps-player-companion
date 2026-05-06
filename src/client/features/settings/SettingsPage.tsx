import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';

export function SettingsPage() {
  const toasts = useToasts();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    </div>
  );
}
