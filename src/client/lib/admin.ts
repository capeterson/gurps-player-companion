import type {
  AdminCampaignDetail,
  AdminCampaignList,
  AdminUserDetail,
  AdminUserList,
  AdminUserSummary,
} from '../../shared/schemas/admin.ts';
import { api } from './api.ts';

interface ListOpts {
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function qs(opts: ListOpts): string {
  const parts: string[] = [];
  if (opts.q) parts.push(`q=${encodeURIComponent(opts.q)}`);
  if (opts.limit !== undefined) parts.push(`limit=${opts.limit}`);
  if (opts.offset !== undefined) parts.push(`offset=${opts.offset}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const adminApi = {
  listUsers: (opts: ListOpts = {}) => api<AdminUserList>(`/admin/users${qs(opts)}`),
  getUser: (id: string) => api<AdminUserDetail>(`/admin/users/${id}`),
  suspend: (id: string) => api<AdminUserSummary>(`/admin/users/${id}/suspend`, { method: 'POST' }),
  unsuspend: (id: string) =>
    api<AdminUserSummary>(`/admin/users/${id}/unsuspend`, { method: 'POST' }),
  schedulePurge: (id: string) =>
    api<AdminUserSummary>(`/admin/users/${id}/purge`, { method: 'POST' }),
  cancelPurge: (id: string) =>
    api<AdminUserSummary>(`/admin/users/${id}/cancel-purge`, { method: 'POST' }),
  listCampaigns: (opts: ListOpts = {}) => api<AdminCampaignList>(`/admin/campaigns${qs(opts)}`),
  getCampaign: (id: string) => api<AdminCampaignDetail>(`/admin/campaigns/${id}`),
};
