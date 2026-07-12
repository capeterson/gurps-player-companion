/**
 * /campaigns/:id — per-campaign landing page.  Renders campaign metadata,
 * member chips, the owner/manager settings entry, and embeds the
 * adventure log scoped to this campaign.  The library lives at
 * /campaigns/:id/library reachable from the header here.
 *
 * Top-level /log and /library still exist as fallbacks for the Campaign
 * dropdown — they pick the first campaign by default — but the canonical
 * entrypoint is now this per-campaign route.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import { AvatarStack } from '../../components/ui/Avatar.tsx';
import { api } from '../../lib/api.ts';
import { useCampaignCharactersList } from '../characters/useCharacterDetail.ts';
import { LogPage } from '../log/LogPage.tsx';
import { CampaignHistoryPanel } from './CampaignHistoryPanel.tsx';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<{ id: string }>('/auth/me'),
  });
  const campaign = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api<CampaignOut>(`/campaigns/${id}`),
    enabled: typeof id === 'string' && id.length > 0,
  });
  // Campaign roster — every member character in this campaign, browsable
  // from the campaign page regardless of the share gate. Per
  // docs/specs/campaign-content-sharing.md this is the ONLY discovery
  // surface for a campaign-shared character the viewer only sees minimally;
  // `/characters` filters them out by ownership.
  const roster = useCampaignCharactersList(
    typeof id === 'string' && id.length > 0 ? id : undefined,
  );

  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  if (campaign.isLoading) return <p className="text-sm text-base-content/60">Loading…</p>;
  if (campaign.isError) {
    return (
      <p className="alert alert-error text-sm">
        {(campaign.error as Error).message ?? 'Failed to load campaign.'}
      </p>
    );
  }
  const c = campaign.data;
  if (!c) return null;

  const myId = me.data?.id ?? null;
  const myMembership = c.members.find((m) => m.userId === myId);
  const viewerRole = myId === c.ownerId ? 'owner' : (myMembership?.role ?? 'member');
  const canManage = viewerRole === 'owner' || viewerRole === 'manager';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="label-eyebrow">
            <Link to="/campaigns" className="link">
              ← All campaigns
            </Link>
          </p>
          <h1 className="font-display text-3xl truncate">{c.name}</h1>
          {c.description && (
            <p className="text-sm text-base-content/60 max-w-prose">{c.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AvatarStack names={c.members.map((m) => m.displayName)} max={6} />
          <span
            className={`chip ${viewerRole === 'owner' ? 'on' : ''}`}
            title={`Your role: ${viewerRole}`}
          >
            {viewerRole === 'owner' ? 'Owner' : viewerRole === 'manager' ? 'Manager' : 'Player'}
          </span>
          <Link to={`/campaigns/${c.id}/library`} className="btn btn-ghost btn-sm">
            Library
          </Link>
          {canManage && (
            <Link to={`/campaigns/${c.id}/gm`} className="btn btn-primary btn-sm">
              GM View
            </Link>
          )}
          {canManage && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSettingsOpen(true)}
              aria-label={`Settings for ${c.name}`}
            >
              ⚙ Settings
            </button>
          )}
        </div>
      </header>

      {/* Campaign roster — browseable from the campaign page. Member
          characters minimal viewers see deep-link to
          /characters/:id, which renders CharacterMinimalView for them. */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Characters</h2>
        {roster === undefined ? (
          <p className="text-sm text-base-content/60">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-base-content/60">No characters in this campaign yet.</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {roster.map((ch) => (
              <li key={ch.id}>
                <Link
                  to={`/characters/${ch.id}`}
                  className="card block p-4 transition hover:border-border-strong"
                >
                  <div className="flex items-baseline justify-between">
                    <p className="font-display text-xl">{ch.name}</p>
                    <span className="label-eyebrow">TL {ch.techLevel ?? '—'}</span>
                  </div>
                  <p className="text-sm text-base-content/70">
                    {ch.playerName ?? 'Player not specified'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Embedded adventure log scoped to this campaign. */}
      <LogPage campaignId={c.id} />

      {/* Campaign history — campaign-level changes (owner also gets character roll-up). */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        <CampaignHistoryPanel campaignId={c.id} isOwner={myId === c.ownerId} />
      </section>

      {settingsOpen && (
        <CampaignSettingsDialog
          open={settingsOpen}
          campaign={c}
          viewerRole={viewerRole}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
