/**
 * Settings → API keys panel.  Lets the user mint, list, and revoke
 * personal API tokens.  The plaintext key is shown exactly once via
 * `ApiKeyCreatedDialog` immediately after creation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { ApiError } from '../../lib/api.ts';
import { apiKeysApi } from '../../lib/apiKeys.ts';
import { useToasts } from '../../lib/toast.tsx';
import { ApiKeyCreatedDialog } from './ApiKeyCreatedDialog.tsx';

export function ApiKeysSection() {
  const qc = useQueryClient();
  const toasts = useToasts();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const list = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiKeysApi.list(),
  });

  const create = useMutation({
    mutationFn: () => apiKeysApi.create(name.trim()),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      setName('');
      setError(null);
      setPlaintext(res.plaintextKey);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Create failed'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiKeysApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toasts.push('API key revoked', { kind: 'success' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Revoke failed', { kind: 'error' }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    create.mutate();
  }

  const items = list.data ?? [];

  return (
    <section className="card gap-4 p-card">
      <div>
        <p className="label-eyebrow">Integrations</p>
        <h2 className="font-display text-2xl">API keys</h2>
        <p className="text-xs text-base-content/60 max-w-prose">
          Mint a long-lived token to authenticate scripts or external tools against this account.
          Tokens prefix <code>gpc_</code> and are shown in plaintext exactly once at creation —
          revoke them here at any time.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <label className="form-control flex-1 min-w-[12rem]">
          <span className="label-text text-xs">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CLI on laptop"
            className="input input-sm input-bordered"
            maxLength={80}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending}>
          {create.isPending ? 'Minting…' : 'Mint key'}
        </button>
      </form>
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="space-y-1">
        {list.isLoading && <p className="text-xs text-base-content/60">Loading…</p>}
        {list.isError && (
          <p className="text-xs text-error">Couldn't load API keys. Refresh to retry.</p>
        )}
        {!list.isLoading && items.length === 0 && (
          <p className="text-xs text-base-content/60">No API keys yet.</p>
        )}
        {items.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium">{k.name}</span>
              <code className="text-xs ml-2">{k.prefix}…</code>
              <span className="ml-2 text-xs text-base-content/60">
                created {new Date(k.createdAt).toLocaleDateString()}
                {k.lastUsedAt
                  ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                  : ' · never used'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              disabled={revoke.isPending}
              onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
              aria-label={`Revoke ${k.name}`}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke API key"
        tone="error"
        confirmLabel="Revoke"
        onConfirm={() => {
          if (revokeTarget) {
            revoke.mutate(revokeTarget.id);
            setRevokeTarget(null);
          }
        }}
        onCancel={() => setRevokeTarget(null)}
      >
        <p>
          Revoke &ldquo;<strong>{revokeTarget?.name}</strong>&rdquo;? Any scripts using it will
          immediately lose access.
        </p>
      </ConfirmDialog>

      <ApiKeyCreatedDialog
        open={plaintext !== null}
        plaintextKey={plaintext ?? ''}
        onAcknowledge={() => setPlaintext(null)}
      />
    </section>
  );
}
