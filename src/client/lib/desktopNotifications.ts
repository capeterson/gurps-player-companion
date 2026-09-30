/** Desktop delivery is per account on this browser. Permission is never requested on mount. */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  type NotificationOut,
  campaignInvitationNotificationPayload,
  eventNotificationPayload,
} from '../../shared/schemas/notification.ts';
const PREFIX = 'gpc:desktop-notifications:';
const EVENT = 'gpc:desktop-notifications-change';
const keyFor = (userId: string) => `${PREFIX}${userId}`;
export function desktopNotificationsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.Notification === 'function' &&
    window.isSecureContext
  );
}
export function desktopNotificationsEnabled(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(keyFor(userId)) === 'true';
  } catch {
    return false;
  }
}
function writeEnabled(userId: string, enabled: boolean): void {
  localStorage.setItem(keyFor(userId), String(enabled));
  // Enabling starts with a baseline: existing unread events never replay as desktop alerts.
  localStorage.removeItem(`${keyFor(userId)}:seen`);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: userId }));
}
export function disableDesktopNotifications(userId: string): void {
  writeEnabled(userId, false);
}
/** Called only from the explicit Settings enable gesture. */
export async function enableDesktopNotifications(userId: string): Promise<void> {
  if (!desktopNotificationsSupported())
    throw new Error('Desktop notifications are unavailable in this browser');
  if (Notification.permission === 'denied')
    throw new Error('Notifications are blocked. Allow them in your browser settings first');
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Browser permission was not granted');
  writeEnabled(userId, true);
}
export function useDesktopNotificationsEnabled(userId: string | undefined): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const local = () => notify();
      const storage = (event: StorageEvent) => {
        if (!event.key || (userId && event.key === keyFor(userId))) notify();
      };
      window.addEventListener(EVENT, local);
      window.addEventListener('storage', storage);
      return () => {
        window.removeEventListener(EVENT, local);
        window.removeEventListener('storage', storage);
      };
    },
    [userId],
  );
  return useSyncExternalStore(
    subscribe,
    () => desktopNotificationsEnabled(userId),
    () => false,
  );
}
export function desktopNotificationCopy(
  notification: NotificationOut,
): { title: string; body: string; href: string | null } | null {
  if (notification.type === 'campaign_invitation') {
    const parsed = campaignInvitationNotificationPayload.safeParse(notification.payload);
    return parsed.success && notification.actionable !== false
      ? {
          title: 'Campaign invitation',
          body: `${parsed.data.inviter_display_name} invited you to ${parsed.data.campaign_name}.`,
          href: '/campaigns',
        }
      : null;
  }
  const parsed = eventNotificationPayload.safeParse(notification.payload);
  // Desktop previews omit character values and shared-log content.
  return parsed.success
    ? {
        title: parsed.data.title,
        body: 'Open Player Companion to view this notification.',
        href: parsed.data.href,
      }
    : null;
}
export async function deliverDesktopNotifications(
  userId: string,
  items: NotificationOut[],
): Promise<void> {
  if (
    !desktopNotificationsEnabled(userId) ||
    !desktopNotificationsSupported() ||
    Notification.permission !== 'granted'
  )
    return;
  const deliver = async () => {
    // Recheck after waiting for another tab's delivery lock.
    if (!desktopNotificationsEnabled(userId) || Notification.permission !== 'granted') return;
    const seenKey = `${keyFor(userId)}:seen`;
    let seen: Set<string>;
    try {
      const raw = localStorage.getItem(seenKey);
      if (!raw) {
        localStorage.setItem(seenKey, JSON.stringify(items.map((item) => item.id)));
        return;
      }
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return;
      seen = new Set(value);
    } catch {
      return;
    } // Fail closed when persistent deduplication is unavailable.
    const fresh = items.filter((item) => !seen.has(item.id) && !item.readAt);
    for (const item of items) seen.add(item.id);
    // Claim before display; multiple tabs or a reload cannot replay the same notification.
    try {
      localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-1000)));
    } catch {
      return;
    }
    if (document.visibilityState === 'visible') return; // The bell already serves the active app.
    for (const item of fresh) {
      const copy = desktopNotificationCopy(item);
      if (!copy) continue;
      try {
        const notification = new Notification(copy.title, {
          body: copy.body,
          tag: item.id,
          icon: '/icon-192.png',
        });
        notification.onclick = () => {
          window.focus();
          if (copy.href) window.location.assign(copy.href);
          notification.close();
        };
      } catch {
        /* Unsupported platforms retain the in-app inbox. */
      }
    }
  };
  // Web Locks prevent duplicate desktop alerts across tabs of this browser.
  if (navigator.locks) {
    try {
      await navigator.locks.request(`gpc:desktop-notifications:${userId}`, deliver);
    } catch {
      // Delivery fails closed if this context cannot acquire browser locks.
    }
  }
}
export function useDesktopNotificationDelivery(
  userId: string | undefined,
  items: NotificationOut[] | undefined,
): void {
  const enabled = useDesktopNotificationsEnabled(userId);
  useEffect(() => {
    if (enabled && userId && items) void deliverDesktopNotifications(userId, items);
  }, [userId, items, enabled]);
}
