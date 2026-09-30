import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationOut } from '../../shared/schemas/notification.ts';
import {
  deliverDesktopNotifications,
  desktopNotificationsEnabled,
  disableDesktopNotifications,
  enableDesktopNotifications,
  useDesktopNotificationDelivery,
} from './desktopNotifications.ts';

const userId = '0193b3c0-f1f0-7000-8000-000000000001';
const otherUserId = '0193b3c0-f1f0-7000-8000-000000000002';

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  static instances: FakeNotification[] = [];

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }

  onclick: ((this: Notification, ev: Event) => unknown) | null = null;
  close = vi.fn();
}

function event(id: string, readAt: string | null = null): NotificationOut {
  return {
    id,
    userId,
    type: 'character_changed',
    payload: {
      topic: 'characterChanges',
      title: 'Character updated',
      message: 'Alex updated Mira.',
      href: '/characters/0193b3c0-f1f0-7000-8000-000000000003#history',
      actorId: otherUserId,
      characterId: '0193b3c0-f1f0-7000-8000-000000000003',
      campaignId: null,
      changes: ['attributes'],
    },
    relatedId: null,
    readAt,
    createdAt: '2026-09-28T12:00:00.000Z',
  };
}

function installNotificationApi(permission: NotificationPermission = 'default') {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  FakeNotification.permission = permission;
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockReset().mockImplementation(async () => {
    FakeNotification.permission = 'granted';
    return 'granted';
  });
  vi.stubGlobal('Notification', FakeNotification);
}

function installLocks() {
  const request = vi.fn(async (_name: string, callback: () => Promise<void>) => callback());
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request },
  });
  return request;
}

beforeEach(() => {
  localStorage.clear();
  installNotificationApi();
  installLocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('desktop notification delivery', () => {
  it('starts disabled and never requests permission or displays when browser permission is already granted', async () => {
    FakeNotification.permission = 'granted';
    renderHook(() => useDesktopNotificationDelivery(userId, [event('notice-1')]));

    await act(async () => Promise.resolve());
    expect(desktopNotificationsEnabled(userId)).toBe(false);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('keeps browser-local opt-in isolated between accounts', async () => {
    await enableDesktopNotifications(userId);

    expect(desktopNotificationsEnabled(userId)).toBe(true);
    expect(desktopNotificationsEnabled(otherUserId)).toBe(false);
    disableDesktopNotifications(userId);
    expect(desktopNotificationsEnabled(userId)).toBe(false);
    expect(desktopNotificationsEnabled(otherUserId)).toBe(false);
  });

  it('asks for browser permission only when the explicit enable function is called', async () => {
    renderHook(() => useDesktopNotificationDelivery(userId, [event('notice-1')]));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    await act(async () => {
      await enableDesktopNotifications(userId);
    });

    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(desktopNotificationsEnabled(userId)).toBe(true);
  });

  it('uses the first delivery fetch as a baseline and does not replay existing unread items', async () => {
    await enableDesktopNotifications(userId);

    await deliverDesktopNotifications(userId, [event('existing-1'), event('existing-2')]);
    await deliverDesktopNotifications(userId, [event('existing-1'), event('existing-2')]);

    expect(FakeNotification.instances).toHaveLength(0);
    expect(localStorage.getItem(`gpc:desktop-notifications:${userId}:seen`)).toContain(
      'existing-1',
    );
  });

  it('displays a new hidden-page notification once across repeated fetches and tabs', async () => {
    await enableDesktopNotifications(userId);
    await deliverDesktopNotifications(userId, [event('baseline')]);
    const locks = installLocks();

    await deliverDesktopNotifications(userId, [event('baseline'), event('new-1')]);
    await deliverDesktopNotifications(userId, [event('baseline'), event('new-1')]);

    expect(locks).toHaveBeenCalledTimes(2);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0]?.title).toBe('Character updated');
    expect(FakeNotification.instances[0]?.options?.body).toBe(
      'Open Player Companion to view this notification.',
    );
  });

  it('suppresses OS alerts while the app is visible', async () => {
    await enableDesktopNotifications(userId);
    await deliverDesktopNotifications(userId, [event('baseline')]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    await deliverDesktopNotifications(userId, [event('baseline'), event('visible-new')]);

    expect(FakeNotification.instances).toHaveLength(0);
    expect(localStorage.getItem(`gpc:desktop-notifications:${userId}:seen`)).toContain(
      'visible-new',
    );
  });

  it('fails closed when browser storage is unavailable', async () => {
    await enableDesktopNotifications(userId);
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(desktopNotificationsEnabled(userId)).toBe(false);
    await deliverDesktopNotifications(userId, [event('notice-1')]);

    expect(FakeNotification.instances).toHaveLength(0);
    getItem.mockRestore();
  });

  it('leaves opt-in off when permission is denied or notifications are unsupported', async () => {
    FakeNotification.permission = 'denied';
    await expect(enableDesktopNotifications(userId)).rejects.toThrow(/blocked/i);
    expect(desktopNotificationsEnabled(userId)).toBe(false);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    Reflect.deleteProperty(window, 'Notification');
    await expect(enableDesktopNotifications(userId)).rejects.toThrow(/unavailable/i);
    expect(desktopNotificationsEnabled(userId)).toBe(false);
  });
});
