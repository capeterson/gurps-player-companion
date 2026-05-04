import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api.ts';
import { tokenStore, type Tokens } from '../../lib/tokenStore.ts';

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-base-100">
      <form
        className="card w-96 bg-base-200 border border-base-300 p-6 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          register.mutate();
        }}
      >
        <h1 className="font-display text-2xl">Create an account</h1>
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
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-sm">
          Already have one?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
