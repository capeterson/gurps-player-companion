import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Resolve legacy ?campaign= routes while leaving embedded routes path-driven. */
export function useSelectedCampaignId(
  campaignIdProp: string | undefined,
  campaigns: readonly { id: string }[] | undefined,
) {
  const [params, setParams] = useSearchParams();
  const urlCampaign = params.get('campaign');
  const campaignId = useMemo(() => {
    if (campaignIdProp) return campaignIdProp;
    if (urlCampaign && campaigns?.some((campaign) => campaign.id === urlCampaign))
      return urlCampaign;
    return campaigns?.[0]?.id ?? null;
  }, [campaignIdProp, urlCampaign, campaigns]);

  useEffect(() => {
    if (campaignIdProp || !campaignId || urlCampaign === campaignId) return;
    const next = new URLSearchParams(params);
    next.set('campaign', campaignId);
    setParams(next, { replace: true });
  }, [campaignIdProp, campaignId, urlCampaign, params, setParams]);

  return { campaignId, params, setParams };
}
