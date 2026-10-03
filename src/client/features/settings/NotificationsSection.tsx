import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_TOPICS,
  type NotificationPreferences,
} from '../../../shared/schemas/notificationPreferences.ts';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { useDraftToggle } from '../../hooks/useDraftToggle.ts';
import { api } from '../../lib/api.ts';
import {
  desktopNotificationsSupported,
  disableDesktopNotifications,
  enableDesktopNotifications,
  useDesktopNotificationsEnabled,
} from '../../lib/desktopNotifications.ts';

function PreferenceToggle({
  label,
  description,
  value,
  onSave,
}: {
  label: string;
  description?: string;
  value: boolean;
  onSave: (value: boolean) => Promise<unknown>;
}) {
  const draft = useDraftToggle({ name: label, serverValue: value, onSave });
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        className="toggle toggle-sm shrink-0 field-rollback-flash"
        aria-label={label}
        checked={draft.checked}
        onChange={draft.toggle}
        {...draft.flashProps}
      />
    </label>
  );
}
function DesktopToggle({ userId }: { userId: string }) {
  const enabled = useDesktopNotificationsEnabled(userId);
  const supported = desktopNotificationsSupported();
  const draft = useDraftToggle({
    name: 'Desktop notifications',
    serverValue: enabled,
    onSave: async (value) => {
      if (value) await enableDesktopNotifications(userId);
      else disableDesktopNotifications(userId);
    },
  });
  const blocked = supported && Notification.permission === 'denied';
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-4 py-3">
        <span className="min-w-0">
          <span className="block font-medium">Desktop notifications</span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-sm shrink-0 field-rollback-flash"
          aria-label="Desktop notifications"
          checked={draft.checked}
          disabled={!supported || draft.isSaving}
          onChange={draft.toggle}
          {...draft.flashProps}
        />
      </label>
      <output className="block text-xs text-muted">
        {!supported
          ? 'Desktop notifications are unavailable in this browser.'
          : blocked
            ? 'Blocked by your browser. Allow notifications in browser settings to enable them here.'
            : enabled
              ? 'Enabled on this browser. Your in-app topic choices also apply to desktop alerts.'
              : null}
      </output>
    </div>
  );
}
export function NotificationsSection({ userId }: { userId: string | undefined }) {
  const qc = useQueryClient();
  const preferences = useQuery({
    queryKey: ['notification-preferences', userId],
    queryFn: () => api<NotificationPreferences>('/auth/notification-preferences'),
    enabled: Boolean(userId),
  });
  const save = async (key: keyof NotificationPreferences, value: boolean) => {
    await api<NotificationPreferences>('/auth/notification-preferences', {
      method: 'PATCH',
      body: { [key]: value },
    });
    // Merge only the confirmed field; responses to different-field saves may arrive out of order.
    qc.setQueryData<NotificationPreferences>(['notification-preferences', userId], (old) =>
      old ? { ...old, [key]: value } : old,
    );
  };
  return (
    <section id="notification-settings" className="card gap-5 p-card">
      <div>
        <p className="label-eyebrow">Preferences</p>
        <h2 className="font-display text-2xl">Notifications</h2>
      </div>
      {userId && <DesktopToggle key={userId} userId={userId} />}
      {preferences.isError && (
        <QueryReadError
          label="notification settings"
          error={preferences.error}
          onRetry={() => void preferences.refetch()}
        />
      )}
      {!preferences.data && !preferences.isError && (
        <p className="text-sm text-muted">Loading notification settings…</p>
      )}
      {preferences.data && (
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="font-display text-lg">Email</h3>
            <p className="mt-1 text-xs text-muted">
              Email is available only for invitations and security alerts.
            </p>
            <div className="divide-y divide-base-300/60">
              <PreferenceToggle
                label="Campaign invitations"
                value={preferences.data.emailInvitations}
                onSave={(v) => save('emailInvitations', v)}
              />
              <PreferenceToggle
                label="Invitation accepted"
                value={preferences.data.emailInvitationAccepted}
                onSave={(v) => save('emailInvitationAccepted', v)}
              />
              <div className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">Security alerts</p>
                  <p className="text-xs text-muted">
                    Password changes and passkey or API key changes always trigger an email.
                  </p>
                </div>
                <span className="badge badge-outline shrink-0">Always on</span>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg">In-app inbox</h3>
            <div className="divide-y divide-base-300/60">
              {NOTIFICATION_TOPICS.map((topic) => (
                <PreferenceToggle
                  key={topic.key}
                  label={topic.label}
                  description={topic.description}
                  value={preferences.data?.[topic.key] ?? true}
                  onSave={(v) => save(topic.key, v)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
