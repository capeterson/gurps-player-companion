import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MANA_LEVEL_LABELS } from '../../../shared/constants/magic.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { api } from '../../lib/api.ts';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';
import { GmChangeFeed } from './GmChangeFeed.tsx';
import { GmCharacterCard } from './GmCharacterCard.tsx';
import { SkillLookupDialog } from './SkillLookupDialog.tsx';
import { useCampaignCharacterDetails } from './useCampaignCharacterDetails.ts';

export function GmCampaignDashboardPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [dense, setDense] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookup, setLookup] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api<{ id: string }>('/auth/me') });
  const campaign = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api<CampaignOut>(`/campaigns/${id}`),
    enabled: id.length > 0,
  });
  const characters = useCampaignCharacterDetails(id);

  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  if (campaign.isLoading) return <p className="text-sm text-base-content/60">Loading campaign…</p>;
  if (campaign.isError || !campaign.data)
    return (
      <p className="alert alert-error">
        {(campaign.error as Error)?.message ?? 'Campaign not found.'}
      </p>
    );

  const c = campaign.data;
  const membership = c.members.find((member) => member.userId === me.data?.id);
  const viewerRole = me.data?.id === c.ownerId ? 'owner' : (membership?.role ?? 'member');
  const canManage = viewerRole === 'owner' || viewerRole === 'manager';
  const names = new Map(characters?.map((character) => [character.id, character.name]));

  return (
    <div className="mx-auto max-w-[96rem] space-y-4">
      <header className="card border border-base-300 bg-base-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to={`/campaigns/${id}`} className="label-eyebrow link">
              ← Campaign
            </Link>
            <h1 className="font-display text-3xl truncate">{c.name}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip on text-xs">
                {viewerRole === 'owner' ? 'Owner' : viewerRole === 'manager' ? 'Manager' : 'Player'}
              </span>
              <span className="chip text-xs">{MANA_LEVEL_LABELS[c.manaLevel]} mana</span>
              <span className="chip text-xs">
                Sheets {c.shareCharacterSheets ? 'shared' : 'private'}
              </span>
              <span className="chip text-xs">
                GM editing {c.allowGmCharacterEditing ? 'on' : 'off'}
              </span>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <Link to={`/campaigns/${id}/library`} className="btn btn-ghost btn-sm">
              Library
            </Link>
            <Link to={`/campaigns/${id}`} className="btn btn-ghost btn-sm">
              Adventure log
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setLookupOpen(true)}
            >
              Skill lookup
            </button>
            {canManage && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSettingsOpen(true)}
              >
                Settings
              </button>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <span>Dense</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={dense}
                onChange={(event) => setDense(event.target.checked)}
              />
            </label>
          </nav>
        </div>
      </header>

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
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${dense ? 'gap-2' : 'gap-4'}`}
          >
            {characters?.map((character) => (
              <GmCharacterCard
                key={character.id}
                character={character}
                dense={dense}
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

      {settingsOpen && (
        <CampaignSettingsDialog
          open
          campaign={c}
          viewerRole={viewerRole}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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
