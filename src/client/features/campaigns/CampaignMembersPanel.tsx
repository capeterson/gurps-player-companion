/**
 * Owner / manager view of the membership list inside the settings dialog.
 * Owners can promote member ↔ manager and remove anyone but the owner;
 * managers can only remove members.  The owner row is read-only — role
 * transitions go through transfer-ownership instead.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CampaignMemberOut,
  CampaignOut,
  CampaignRole,
  SetMemberRoleRequest,
} from '../../../shared/schemas/campaign.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';

interface Props {
  campaign: CampaignOut;
  viewerRole: CampaignRole;
}

export function CampaignMembersPanel({ campaign, viewerRole }: Props) {
  const qc = useQueryClient();
  const toasts = useToasts();

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'member' | 'manager' }) =>
      api<CampaignOut>(`/campaigns/${campaign.id}/members/${userId}`, {
        method: 'PATCH',
        body: { role } satisfies SetMemberRoleRequest,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toasts.push(`Role updated → ${vars.role}`, { kind: 'success' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Update failed', { kind: 'error' }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/campaigns/${campaign.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toasts.push('Member removed', { kind: 'success' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Remove failed', { kind: 'error' }),
  });

  const isOwner = viewerRole === 'owner';

  function canRemove(member: CampaignMemberOut): boolean {
    if (member.role === 'owner') return false;
    if (isOwner) return true;
    // Managers can only remove regular members.
    return member.role === 'member';
  }

  const members = campaign.members.slice().sort((a, b) => {
    // Owner first, then managers, then members; then by display name.
    const order = { owner: 0, manager: 1, member: 2 } as const;
    const ar = order[a.role];
    const br = order[b.role];
    if (ar !== br) return ar - br;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <section className="border-t border-base-300 pt-3 mt-1">
      <p className="label-eyebrow">Members</p>
      <ul className="mt-2 space-y-1">
        {members.map((m) => {
          const isMemberOwner = m.role === 'owner';
          const promotable = isOwner && m.role === 'member';
          const demotable = isOwner && m.role === 'manager';
          return (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate">{m.displayName}</span>
                <span className="ml-2 text-xs text-base-content/60">{m.email}</span>
                <span
                  className={`ml-2 badge badge-sm ${
                    isMemberOwner
                      ? 'badge-primary'
                      : m.role === 'manager'
                        ? 'badge-secondary'
                        : 'badge-ghost'
                  }`}
                >
                  {m.role}
                </span>
              </div>
              <div className="flex gap-1">
                {promotable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={setRole.isPending}
                    onClick={() => setRole.mutate({ userId: m.userId, role: 'manager' })}
                  >
                    Promote
                  </button>
                )}
                {demotable && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={setRole.isPending}
                    onClick={() => setRole.mutate({ userId: m.userId, role: 'member' })}
                  >
                    Demote
                  </button>
                )}
                {canRemove(m) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(m.userId)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
