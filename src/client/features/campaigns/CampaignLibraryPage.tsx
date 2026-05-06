/**
 * /campaigns/:id/library — per-campaign library wrapper around the
 * existing LibraryPage.  Same content, just routed at the per-campaign
 * URL with a back link to the campaign.
 */

import { Link, useParams } from 'react-router-dom';
import { LibraryPage } from '../library/LibraryPage.tsx';

export function CampaignLibraryPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;

  return (
    <div className="space-y-3">
      <p className="label-eyebrow">
        <Link to={`/campaigns/${id}`} className="link">
          ← Campaign
        </Link>
      </p>
      <LibraryPage campaignId={id} />
    </div>
  );
}
