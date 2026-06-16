import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api.ts';
import { getPasskey, passkeysSupported } from '../../lib/passkeys.ts';
import { type Tokens, tokenStore } from '../../lib/tokenStore.ts';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const passkeyLogin = useMutation({
    mutationFn: async () => {
      if (!passkeysSupported()) throw new Error('Passkeys are not supported by this browser');
      const options = await api<PublicKeyCredentialRequestOptions>('/auth/passkeys/login/options', {
        method: 'POST',
        body: { email: email || undefined },
        authenticated: false,
      });
      const assertion = await getPasskey(options);
      return api<Tokens>('/auth/passkeys/login', {
        method: 'POST',
        body: assertion,
        authenticated: false,
      });
    },
    onSuccess: (tokens) => {
      tokenStore.write(tokens);
      navigate('/');
    },
    onError: (err) => {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'passkey login failed',
      );
    },
  });

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
    <div className="arcane-edge flex min-h-screen items-center justify-center bg-base-200 p-6">
      <form
        className="card relative z-10 flex w-full max-w-sm flex-col gap-3 p-card"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate();
        }}
      >
        <p className="label-eyebrow">Player Companion</p>
        <h1 className="font-display text-3xl font-semibold">Sign in</h1>
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
        {error && <p className="alert alert-error text-sm">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={login.isPending || passkeyLogin.isPending}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={login.isPending || passkeyLogin.isPending || !passkeysSupported()}
          onClick={() => {
            setError(null);
            passkeyLogin.mutate();
          }}
        >
          {passkeyLogin.isPending ? 'Checking passkey…' : 'Use a passkey'}
        </button>
        <p className="text-sm text-muted">
          <Link to="/forgot-password" className="link link-primary">
            Forgot your password?
          </Link>
        </p>
        <p className="text-sm text-muted">
          New here?{' '}
          <Link to="/register" className="link link-primary">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
