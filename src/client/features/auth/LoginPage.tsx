import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api.ts';
import { tokenStore, type Tokens } from '../../lib/tokenStore.ts';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: () =>
      api<Tokens>('/auth/login', {
        method: 'POST',
        body: { email, password },
        authenticated: false,
      }),
    onSuccess: (tokens) => {
      tokenStore.write(tokens);
      navigate('/');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'login failed');
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-base-100">
      <form
        className="card w-96 bg-base-200 border border-base-300 p-6 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate();
        }}
      >
        <h1 className="font-display text-2xl">Sign in</h1>
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
          <span className="label-text">Password</span>
          <input
            type="password"
            className="input input-bordered"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-sm">
          New here?{' '}
          <Link to="/register" className="link">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
