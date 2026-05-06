/**
 * Thin client wrappers for the notifications API.
 */

import type { NotificationOut } from '../../shared/schemas/notification.ts';
import { api } from './api.ts';

export const notificationsApi = {
  list: (opts: { unreadOnly?: boolean } = {}) =>
    api<NotificationOut[]>(`/notifications${opts.unreadOnly ? '?unreadOnly=true' : ''}`),
  markRead: (id: string) => api<NotificationOut>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<void>('/notifications/read-all', { method: 'POST' }),
  dismiss: (id: string) => api<void>(`/notifications/${id}`, { method: 'DELETE' }),
};
