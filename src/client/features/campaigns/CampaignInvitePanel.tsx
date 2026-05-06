/**
 * Owner / manager view inside the campaign settings dialog: invite a
 * user (by email or display name), then list pending invitations with a
 * cancel affordance.  Only owners may invite at the manager tier — the
 * UI hides the role <select> when the viewer is a manager.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CampaignRole, InvitationOut } from '../../../shared/schemas/campaign.ts';
import { ApiError } from '../../lib/api.ts';
import { invitationsApi } from '../../lib/invitations.ts';
import { useToasts } from '../../lib/toast.tsx';

interface Props {
  campaignId: string;
  /** Viewer's role in this campaign — gates whether the manager option is offered. */
  viewerRole: CampaignRole;
}

export function CampaignInvitePanel({ campaignId, viewerRole }: Props) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const queryKey = ['campaign-invitations', campaignId] as const;

  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<CampaignRole>('member');
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey,
    queryFn: () => invitationsApi.listForCampaign(campaignId),
  });

  const create = useMutation({
    mutationFn: () => invitationsApi.create(campaignId, { handle: handle.trim(), role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setHandle('');
      setRole('member');
      setError(null);
      toasts.push('Invitation sent', { kind: 'success' });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Invite failed'),
  });

  const cancel = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.cancel(campaignId, invitationId),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err) => {
      toasts.push(err instanceof ApiError ? err.message : 'Cancel failed', { kind: 'error' });
    },
  });

  function trySubmit() {
    setError(null);
    if (!handle.trim()) {
      setError('Enter an email or display name');
      return;
    }
    create.mutate();
  }

  const pending = list.data ?? [];

  return (
    // The settings dialog wraps everything in a <form method="dialog">,
    // so a nested <form> here would let the inner submit bubble up and
    // close the dialog. Use a plain div + onClick handlers instead.
    <section className="border-t border-base-300 pt-3 mt-1">
      <p className="label-eyebrow">Invitations</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="form-control flex-1 min-w-[12rem]">
          <span className="label-text text-xs">Invite by email or display name</span>
          <input
            className="input input-bordered input-sm"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                trySubmit();
              }
            }}
            placeholder="someone@example.com or Display Name"
          />
        </label>
        {viewerRole === 'owner' ? (
          <label className="form-control">
            <span className="label-text text-xs">Role</span>
            <select
              className="select select-bordered select-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as CampaignRole)}
            >
              <option value="member">Member</option>
              <option value="manager">Manager</option>
            </select>
          </label>
        ) : (
          <span className="text-xs text-base-content/60 self-end pb-2">
            Managers may invite at the member tier; only the owner promotes managers.
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={create.isPending}
          onClick={trySubmit}
        >
          {create.isPending ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm mt-2">{error}</p>}

      <div className="mt-3 space-y-1">
        {list.isLoading && <p className="text-xs text-base-content/60">Loading…</p>}
        {list.isError && (
          <p className="text-xs text-error">Couldn't load invitations. Refresh to retry.</p>
        )}
        {!list.isLoading && pending.length === 0 && (
          <p className="text-xs text-base-content/60">No pending invitations.</p>
        )}
        {pending.map((inv: InvitationOut) => (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium truncate">{inv.inviteeDisplayName}</span>
              <span className="ml-2 text-xs text-base-content/60">{inv.inviteeEmail}</span>
              <span className="ml-2 badge badge-sm badge-ghost">{inv.role}</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => cancel.mutate(inv.id)}
              disabled={cancel.isPending}
              aria-label={`Cancel invitation for ${inv.inviteeDisplayName}`}
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
