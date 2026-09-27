import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { CampaignOut, CampaignRole } from '../../../shared/schemas/campaign.ts';
import { type LocalCampaign, getLocalDb } from '../../db/dexie.ts';
import { ApiError, api } from '../../lib/api.ts';
import { readUserIdFromToken } from '../../lib/tokenStore.ts';
import { useMirrorCampaigns } from '../characters/useMirrorCampaigns.ts';

export interface CampaignWorkspace {
  campaign: CampaignOut | LocalCampaign | undefined;
  remoteCampaign: CampaignOut | undefined;
  viewerId: string | null;
  viewerRole: CampaignRole;
  canManage: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * One campaign identity source for every campaign page. The local mirror is
 * deliberately the fallback so the library shell and its navigation remain
 * available offline; explicit authorization failures still hide stale rows.
 */
export function useCampaignWorkspace(id: string): CampaignWorkspace {
  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<{ id: string }>('/auth/me'),
  });
  const remote = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api<CampaignOut>(`/campaigns/${id}`),
    enabled: id.length > 0,
  });
  const local = useLiveQuery(() => (id ? getLocalDb().campaigns.get(id) : undefined), [id], null);

  // Keep this identity stable. Rebuilding `[remote.data]` on every render can
  // restart the mirror write and starve sibling Dexie live queries.
  const campaignMirror = useMemo(() => (remote.data ? [remote.data] : undefined), [remote.data]);
  useMirrorCampaigns(campaignMirror);

  const denied = remote.error instanceof ApiError && [401, 403, 404].includes(remote.error.status);
  const campaign = denied ? undefined : (remote.data ?? local ?? undefined);
  const viewerId = me.data?.id ?? readUserIdFromToken();
  const membership = remote.data?.members.find((member) => member.userId === viewerId);
  const viewerRole: CampaignRole =
    viewerId === campaign?.ownerId ? 'owner' : (membership?.role ?? local?.viewerRole ?? 'member');

  return {
    campaign,
    remoteCampaign: remote.data,
    viewerId,
    viewerRole,
    canManage: viewerRole === 'owner' || viewerRole === 'manager',
    isLoading: campaign === undefined && (remote.isLoading || local === null),
    error: remote.error instanceof Error ? remote.error : null,
  };
}
