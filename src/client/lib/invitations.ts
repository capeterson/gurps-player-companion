/**
 * Thin client wrappers for the invitations API.  Kept tiny because the
 * UI calls these via TanStack Query mutations / queries directly; the
 * helpers here just centralise the URL paths so a future rename or
 * versioning is one change.
 */

import type { InvitationOut, InviteRequest } from '../../shared/schemas/campaign.ts';
import { api } from './api.ts';

export const invitationsApi = {
  listForCampaign: (campaignId: string) =>
    api<InvitationOut[]>(`/campaigns/${campaignId}/invitations`),
  create: (campaignId: string, body: InviteRequest) =>
    api<InvitationOut>(`/campaigns/${campaignId}/invitations`, { method: 'POST', body }),
  cancel: (campaignId: string, invitationId: string) =>
    api<void>(`/campaigns/${campaignId}/invitations/${invitationId}`, { method: 'DELETE' }),
  listMine: () => api<InvitationOut[]>('/invitations'),
  accept: (invitationId: string) =>
    api<InvitationOut>(`/invitations/${invitationId}/accept`, { method: 'POST' }),
  reject: (invitationId: string) =>
    api<InvitationOut>(`/invitations/${invitationId}/reject`, { method: 'POST' }),
};
