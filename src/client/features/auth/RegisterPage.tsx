import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api.ts';
import { type Tokens, tokenStore } from '../../lib/tokenStore.ts';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const register = useMutation({
    mutationFn: () =>
      api<Tokens>('/auth/register', {
        method: 'POST',
        body: { email, password, displayName },
        authenticated: false,
      }),
    onSuccess: (tokens) => {
      tokenStore.write(tokens);
      navigate('/');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'registration failed');
    },
  });

  return (
    <div className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
      <form
        className="card relative z-10 flex w-full max-w-sm flex-col gap-3 p-card"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          register.mutate();
        }}
      >
        <p className="label-eyebrow">Player Companion</p>
        <h1 className="font-display text-3xl font-semibold">Create an account</h1>
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
        <label className="form-control">
          <span className="label-text">Display name</span>
          <input
            className="input input-bordered"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label className="form-control">
          <span className="label-text">Password (min 8 chars)</span>
          <input
            type="password"
            className="input input-bordered"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="alert alert-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-sm text-muted">
          Already have one?{' '}
          <Link to="/login" className="link link-primary">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
