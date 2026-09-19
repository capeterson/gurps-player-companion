import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';

interface Grant {
  id: string;
  clientId: string;
  clientName: string;
  scopes: Array<'gpc:read' | 'gpc:write' | 'gpc:manage'>;
  createdAt: string;
  lastUsedAt: string | null;
}

const labels = {
  'gpc:read': 'Read',
  'gpc:write': 'Create and update',
  'gpc:manage': 'Delete and manage access',
} as const;

export function ConnectedAppsSection() {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const grants = useQuery({
    queryKey: ['oauth-grants'],
    queryFn: () => api<Grant[]>('/oauth/grants'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/oauth/grants/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['oauth-grants'] });
      toasts.push('Connected app revoked', { kind: 'success' });
    },
    onError: (error) =>
      toasts.push(
        `Couldn't revoke connected app — ${error instanceof Error ? error.message : 'request failed'}`,
        { kind: 'error' },
      ),
  });

  return (
    <section className="max-w-lg">
      <div className="card gap-4 p-card">
        <div>
          <p className="label-eyebrow">Delegated access</p>
          <h2 className="font-display text-2xl">Connected apps</h2>
          <p className="text-sm text-muted">
            Apps you approved can keep working after you sign out here. Revoke a connection to stop
            it immediately.
          </p>
        </div>
        {grants.isError && <p className="text-sm text-error">Couldn't load connected apps.</p>}
        {grants.data?.length === 0 && <p className="text-sm text-muted">No connected apps.</p>}
        {grants.data?.map((grant) => (
          <div key={grant.id} className="space-y-2 rounded-box border border-base-300 p-3">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium">{grant.clientName}</p>
                <p className="text-xs text-muted">
                  Connected {new Date(grant.createdAt).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted">
                  {grant.lastUsedAt
                    ? `Last used ${new Date(grant.lastUsedAt).toLocaleString()}`
                    : 'Not used yet'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm self-end text-error sm:self-auto"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(grant.id)}
              >
                Revoke
              </button>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label={`Scopes for ${grant.clientName}`}>
              {grant.scopes.map((scope) => (
                <li key={scope} className="badge badge-outline">
                  {labels[scope]}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
