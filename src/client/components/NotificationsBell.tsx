/**
 * Header notification bell.  Polls /notifications every 30 s (matches
 * gurps-player-web) and renders a dropdown with per-row actions:
 *   - Unread campaign-invitation rows show Accept / Decline that call
 *     into the invitations API; the server marks the notification read
 *     as part of accept/reject so the bell clears on next poll.
 *   - Already-read or non-actionable rows show Dismiss instead.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type NotificationOut,
  campaignInvitationNotificationPayload,
} from '../../shared/schemas/notification.ts';
import { ApiError } from '../lib/api.ts';
import { invitationsApi } from '../lib/invitations.ts';
import { notificationsApi } from '../lib/notifications.ts';
import { useToasts } from '../lib/toast.tsx';

const REFRESH_INTERVAL_MS = 30_000;

function isCampaignInvite(n: NotificationOut): boolean {
  return n.type === 'campaign_invitation';
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const toasts = useToasts();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const items = data ?? [];
  const unread = items.filter((n) => n.readAt === null);

  const accept = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.accept(invitationId),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['invitations', 'mine'] });
      toasts.push(`Joined ${inv.campaignName}`, { kind: 'success' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Accept failed', { kind: 'error' }),
  });

  const reject = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.reject(invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['invitations', 'mine'] });
      toasts.push('Invitation declined', { kind: 'info' });
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Reject failed', { kind: 'error' }),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => notificationsApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Dismiss failed', { kind: 'error' }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <details className="dropdown dropdown-end relative z-50">
      <summary
        className="btn btn-ghost btn-sm btn-square relative"
        aria-label={unread.length > 0 ? `Notifications (${unread.length} unread)` : 'Notifications'}
      >
        <BellIcon />
        {unread.length > 0 && (
          <span
            data-testid="notifications-unread-badge"
            className="badge badge-xs badge-error absolute -top-0.5 -right-0.5 num"
          >
            {unread.length}
          </span>
        )}
      </summary>
      <div className="dropdown-content z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-base-300/60 bg-base-100 p-3 shadow-arcane-lg">
        <div className="flex items-baseline justify-between mb-2">
          <span className="label-eyebrow">Notifications</span>
          {unread.length > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-base-content/60 hover:text-base-content"
            >
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-base-content/60 py-4 text-center">You're all caught up.</p>
        ) : (
          <ul className="grid gap-2 max-h-96 overflow-y-auto">
            {items.map((n) => {
              const inviteId = n.relatedId;
              // Parse via the shared payload schema; fall back to
              // placeholder copy for malformed/legacy rows rather than
              // hiding the notification entirely.
              const parsed = campaignInvitationNotificationPayload.safeParse(n.payload);
              const inviter = parsed.success ? parsed.data.inviter_display_name : 'Someone';
              const campaignName = parsed.success ? parsed.data.campaign_name : 'a campaign';
              const role = parsed.success ? parsed.data.role : 'member';
              const isUnread = n.readAt === null;
              // Accept / Decline only while the underlying invite is still
              // actionable. Past that, show Dismiss so the row can be
              // cleared without firing a stale request.
              const showInviteActions = isCampaignInvite(n) && inviteId !== null && isUnread;
              return (
                <li
                  key={n.id}
                  className={`rounded-lg border border-base-300/60 px-3 py-2 ${
                    isUnread ? 'bg-base-200/40' : 'bg-base-100'
                  }`}
                >
                  <p className="text-sm">
                    <strong>{inviter}</strong> invited you to <strong>{campaignName}</strong>
                    {role === 'manager' ? ' as a manager' : ''}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {showInviteActions && inviteId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => accept.mutate(inviteId)}
                          disabled={accept.isPending}
                          className="btn btn-primary btn-xs"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => reject.mutate(inviteId)}
                          disabled={reject.isPending}
                          className="btn btn-ghost btn-xs"
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dismiss.mutate(n.id)}
                        className="btn btn-ghost btn-xs"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
