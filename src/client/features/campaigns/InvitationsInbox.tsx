/**
 * "You have invitations" inbox shown above the campaigns list.
 * Renders nothing while the request is loading or the list is empty so
 * the page header doesn't shift around for users with zero pending
 * invitations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api.ts';
import { invitationsApi } from '../../lib/invitations.ts';
import { useToasts } from '../../lib/toast.tsx';

export function InvitationsInbox() {
  const qc = useQueryClient();
  const toasts = useToasts();
  const queryKey = ['invitations', 'mine'] as const;

  const list = useQuery({
    queryKey,
    queryFn: () => invitationsApi.listMine(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
  };

  const accept = useMutation({
    mutationFn: (id: string) => invitationsApi.accept(id),
    onSuccess: (inv) => {
      invalidate();
      toasts.push(`Joined ${inv.campaignName}`, { kind: 'success' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Accept failed', { kind: 'error' }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => invitationsApi.reject(id),
    onSuccess: () => invalidate(),
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Reject failed', { kind: 'error' }),
  });

  const items = list.data ?? [];
  if (list.isLoading || items.length === 0) return null;

  return (
    <section className="card border-l-[3px] border-l-info p-card space-y-2">
      <header>
        <p className="label-eyebrow">Invitations</p>
        <h2 className="font-display text-lg">
          You have {items.length} pending invitation{items.length === 1 ? '' : 's'}
        </h2>
      </header>
      <ul className="space-y-2">
        {items.map((inv) => (
          <li
            key={inv.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium">{inv.campaignName}</span>
              <span className="ml-2 text-xs text-base-content/60">
                from {inv.inviterDisplayName}
              </span>
              <span className="ml-2 badge badge-sm badge-ghost">{inv.role}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-xs"
                disabled={accept.isPending || reject.isPending}
                onClick={() => accept.mutate(inv.id)}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                disabled={accept.isPending || reject.isPending}
                onClick={() => reject.mutate(inv.id)}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
