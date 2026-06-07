import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const request = useMutation({
    mutationFn: () =>
      api('/auth/forgot-password', {
        method: 'POST',
        body: { email },
        authenticated: false,
      }),
    onSuccess: () => setSubmitted(true),
  });

  return (
    <div className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
      <div className="card relative z-10 flex w-full max-w-sm flex-col gap-3 p-card">
        <p className="label-eyebrow">Player Companion</p>
        <h1 className="font-display text-3xl font-semibold">Forgot password</h1>
        {submitted ? (
          <>
            <p className="text-sm">
              If that email address is registered, we've sent a password reset link. Check your
              inbox.
            </p>
            <Link to="/login" className="btn btn-primary">
              Back to sign in
            </Link>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <label className="form-control">
              <span className="label-text">Email</span>
              <input
                type="email"
                className="input input-bordered"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {request.isError && (
              <p className="alert alert-error text-sm">Something went wrong. Please try again.</p>
            )}
            <button type="submit" className="btn btn-primary" disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-sm text-muted">
              Remember your password?{' '}
              <Link to="/login" className="link link-primary">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
