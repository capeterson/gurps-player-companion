import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CampaignPageHeading, CampaignWorkspaceHeader } from './CampaignWorkspaceHeader.tsx';
import { GmChangeFeed } from './GmChangeFeed.tsx';
import { GmCharacterCard } from './GmCharacterCard.tsx';
import { SkillLookupDialog } from './SkillLookupDialog.tsx';
import { useCampaignCharacterDetails } from './useCampaignCharacterDetails.ts';
import { useCampaignWorkspace } from './useCampaignWorkspace.ts';

export function GmCampaignDashboardPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookup, setLookup] = useState<string | null>(null);
  const workspace = useCampaignWorkspace(id);
  const characters = useCampaignCharacterDetails(id);

  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  const c = workspace.campaign;
  if (!c && workspace.isLoading)
    return <p className="text-sm text-base-content/60">Loading campaign…</p>;
  if (!c)
    return <p className="alert alert-error">{workspace.error?.message ?? 'Campaign not found.'}</p>;

  const canManage = workspace.canManage;
  const names = new Map(characters?.map((character) => [character.id, character.name]));

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <CampaignWorkspaceHeader campaignId={id} workspace={workspace} />
      <CampaignPageHeading
        title="GM dashboard"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => setLookupOpen(true)}>
            Skill lookup
          </button>
        }
      />

      <main className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          {characters === undefined && (
            <p className="p-4 text-sm text-base-content/50">Loading local character data…</p>
          )}
          {characters?.length === 0 && (
            <div className="card border border-dashed border-base-300 p-8 text-center text-base-content/50">
              No characters have joined this campaign.
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {characters?.map((character) => (
              <GmCharacterCard
                key={character.id}
                character={character}
                campaignName={c.name}
                lookup={lookup}
              />
            ))}
          </div>
        </section>
        {canManage ? (
          <GmChangeFeed campaignId={id} characterNames={names} />
        ) : (
          <div className="alert text-sm">
            The live change feed is available to campaign owners and managers.
          </div>
        )}
      </main>

      {lookupOpen && (
        <SkillLookupDialog
          open
          characters={characters ?? []}
          onClose={() => setLookupOpen(false)}
          onSelect={setLookup}
        />
      )}
    </div>
  );
}
