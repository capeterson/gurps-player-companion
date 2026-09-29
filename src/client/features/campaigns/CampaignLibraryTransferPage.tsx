import { useParams } from 'react-router-dom';
import { LibraryPage } from '../library/LibraryPage.tsx';
import { CampaignWorkspaceHeader } from './CampaignWorkspaceHeader.tsx';
import { useCampaignWorkspace } from './useCampaignWorkspace.ts';

export function CampaignLibraryTransferPage() {
  const { id = '' } = useParams<{ id: string }>();
  const workspace = useCampaignWorkspace(id);
  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  if (workspace.isLoading) return <p className="text-sm text-base-content/60">Loading campaign…</p>;
  if (!workspace.campaign)
    return <p className="alert alert-error">{workspace.error?.message ?? 'Campaign not found.'}</p>;
  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <CampaignWorkspaceHeader campaignId={id} workspace={workspace} />
      <LibraryPage campaignId={id} transferOnly />
    </div>
  );
}
