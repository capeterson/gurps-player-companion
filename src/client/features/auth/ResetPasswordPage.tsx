import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { tokenStore } from '../../lib/tokenStore.ts';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const toasts = useToasts();

  const reset = useMutation({
    mutationFn: () =>
      api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
        authenticated: false,
      }),
    onSuccess: () => {
      tokenStore.clear();
      toasts.push('Password updated. Please sign in.', { kind: 'success' });
      navigate('/login');
    },
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'This reset link is invalid or has expired. Please request a new one.'
          : 'Something went wrong. Please try again.',
      );
    },
  });

  if (!token) {
    return (
      <div className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
        <div className="card relative z-10 flex w-full max-w-sm flex-col gap-3 p-card">
          <p className="label-eyebrow">Player Companion</p>
          <h1 className="font-display text-3xl font-semibold">Reset password</h1>
          <p className="alert alert-error text-sm">
            Missing reset token. Please use the link from your email.
          </p>
          <Link to="/forgot-password" className="btn btn-primary">
            Request new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
      <form
        className="card relative z-10 flex w-full max-w-sm flex-col gap-3 p-card"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (newPassword !== confirm) {
            setError('Passwords do not match.');
            return;
          }
          reset.mutate();
        }}
      >
        <p className="label-eyebrow">Player Companion</p>
        <h1 className="font-display text-3xl font-semibold">Reset password</h1>
        <label className="form-control">
          <span className="label-text">New password</span>
          <input
            type="password"
            className="input input-bordered"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label className="form-control">
          <span className="label-text">Confirm password</span>
          <input
            type="password"
            className="input input-bordered"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <p className="alert alert-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={reset.isPending}>
          {reset.isPending ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
