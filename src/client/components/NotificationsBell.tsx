/**
 * Header notification bell.  Polls /notifications every 30 s (matches
 * gurps-player-web) and renders a dropdown with per-row actions:
 *   - Pending campaign-invitation rows show Accept / Decline that call
 *     into the invitations API; the server marks the notification read
 *     as part of accept/reject so the bell clears on next poll.
 *   - Non-actionable rows show Dismiss; reading an invitation leaves it actionable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  type NotificationOut,
  campaignInvitationNotificationPayload,
  eventNotificationPayload,
} from '../../shared/schemas/notification.ts';
import { useConnectionStatus } from '../hooks/useConnectionStatus.ts';
import { useViewportBoundedOverlay } from '../hooks/useViewportBoundedOverlay.ts';
import { ApiError, api } from '../lib/api.ts';
import { useDesktopNotificationDelivery } from '../lib/desktopNotifications.ts';
import { invitationsApi } from '../lib/invitations.ts';
import { notificationsApi } from '../lib/notifications.ts';
import { useToasts } from '../lib/toast.tsx';
import { AppIcon } from './ui/AppIcon.tsx';
import { QueryReadError } from './ui/QueryReadError.tsx';

const REFRESH_INTERVAL_MS = 30_000;

function isCampaignInvite(n: NotificationOut): boolean {
  return n.type === 'campaign_invitation';
}

export function NotificationsBell({ triggerClassName = '' }: { triggerClassName?: string } = {}) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const { online } = useConnectionStatus();
  const panelRef = useViewportBoundedOverlay<HTMLDivElement>(true, undefined, {
    constrainHeight: true,
  });

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api<{ id: string }>('/auth/me') });
  useDesktopNotificationDelivery(me.data?.id, notifications.data);
  const items = notifications.data ?? [];
  const unavailableOffline = !online && notifications.data === undefined;
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

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) =>
      toasts.push(err instanceof Error ? err.message : 'Could not mark notification read', {
        kind: 'error',
      }),
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) =>
      toasts.push(err instanceof Error ? err.message : 'Could not mark notifications read', {
        kind: 'error',
      }),
  });

  return (
    <details className="dropdown dropdown-end relative z-50">
      <summary
        className={`btn btn-ghost btn-sm btn-square relative ${triggerClassName}`}
        aria-label={unread.length > 0 ? `Notifications (${unread.length} unread)` : 'Notifications'}
      >
        <AppIcon name="bell" />
        {unread.length > 0 && (
          <span
            data-testid="notifications-unread-badge"
            className="badge badge-xs badge-error absolute -top-0.5 -right-0.5 num"
          >
            {unread.length}
          </span>
        )}
      </summary>
      <div
        ref={panelRef}
        style={{
          marginRight: 'calc(0px - var(--viewport-overlay-shift-x, 0px))',
          maxHeight:
            'min(calc(100dvh - 1rem), var(--viewport-overlay-available-height, calc(100dvh - 5rem)))',
        }}
        className="dropdown-content z-50 mt-2 w-[min(20rem,calc(100dvw-1rem))] max-w-[var(--viewport-overlay-available-width,calc(100dvw-1rem))] [overflow-wrap:anywhere] overflow-y-auto rounded-xl border border-base-300/60 bg-base-100 p-3 shadow-arcane-lg"
      >
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
        {unavailableOffline ? (
          <p className="text-sm text-base-content/60 py-4 text-center">
            Notifications unavailable offline.
          </p>
        ) : (
          notifications.isError && (
            <QueryReadError
              label="notifications"
              error={notifications.error}
              onRetry={() => void notifications.refetch()}
            />
          )
        )}
        {items.length === 0 && !notifications.isError && !unavailableOffline ? (
          <p className="text-sm text-base-content/60 py-4 text-center">You're all caught up.</p>
        ) : items.length > 0 ? (
          <ul className="grid gap-2">
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
              const showInviteActions =
                isCampaignInvite(n) && inviteId !== null && (n.actionable ?? isUnread);
              const event = eventNotificationPayload.safeParse(n.payload);
              return (
                <li
                  key={n.id}
                  className={`rounded-lg border border-base-300/60 px-3 py-2 ${
                    isUnread ? 'bg-base-200/40' : 'bg-base-100'
                  }`}
                >
                  {isCampaignInvite(n) ? (
                    <p className="text-sm">
                      <strong>{inviter}</strong> invited you to <strong>{campaignName}</strong>
                      {role === 'manager' ? ' as a manager' : ''}.
                    </p>
                  ) : event.success ? (
                    <div className="text-sm">
                      <p className="font-medium">{event.data.title}</p>
                      <p>{event.data.message}</p>
                    </div>
                  ) : (
                    <p className="text-sm">
                      A notification is available. Its details could not be displayed.
                    </p>
                  )}
                  <time className="mt-1 block text-xs text-muted" dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!isCampaignInvite(n) && event.success && event.data.href && (
                      <Link
                        className="btn btn-ghost btn-xs"
                        to={event.data.href}
                        onClick={(event) => {
                          if (isUnread) markRead.mutate(n.id);
                          const dropdown = event.currentTarget.closest('details');
                          if (dropdown) dropdown.open = false;
                        }}
                      >
                        View
                      </Link>
                    )}
                    {isUnread && !showInviteActions && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        Mark read
                      </button>
                    )}
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
        ) : null}
      </div>
    </details>
  );
}
