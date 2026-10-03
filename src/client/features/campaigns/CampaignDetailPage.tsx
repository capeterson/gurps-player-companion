/**
 * /campaigns/:id — campaign overview. The workspace header owns sibling
 * navigation; this page stays focused on campaign facts and its roster.
 */

import { useParams } from 'react-router-dom';
import { MANA_LEVEL_LABELS } from '../../../shared/constants/magic.ts';
import { CharacterCard } from '../characters/CharacterCard.tsx';
import { useCampaignCharactersList } from '../characters/useCharacterDetail.ts';
import { CampaignPageHeading, CampaignWorkspaceHeader } from './CampaignWorkspaceHeader.tsx';
import { useCampaignWorkspace } from './useCampaignWorkspace.ts';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useCampaignWorkspace(id ?? '');
  // Campaign roster — every member character in this campaign, browsable
  // from the campaign page regardless of the share gate. Per
  // docs/specs/campaign-content-sharing.md this is the ONLY discovery
  // surface for a campaign-shared character the viewer only sees minimally;
  // `/characters` filters them out by ownership.
  const roster = useCampaignCharactersList(
    typeof id === 'string' && id.length > 0 ? id : undefined,
  );

  if (!id) return <p className="alert alert-error">Missing campaign id.</p>;
  if (workspace.isLoading) return <p className="text-sm text-base-content/60">Loading campaign…</p>;
  const c = workspace.campaign;
  if (!c)
    return (
      <p className="alert alert-error text-sm">
        {workspace.error?.message ?? 'Failed to load campaign.'}
      </p>
    );

  return (
    <div className="mx-auto max-w-[96rem] space-y-6">
      <CampaignWorkspaceHeader campaignId={c.id} workspace={workspace} />

      <section className="max-w-5xl space-y-4">
        <CampaignPageHeading title="Overview" />
        <dl className="stats stats-vertical w-full border border-base-300 bg-base-100 sm:stats-horizontal">
          <div className="stat py-3">
            <dt className="stat-title text-xs">Point target</dt>
            <dd className="stat-value text-xl">{c.pointTarget ?? '—'}</dd>
          </div>
          <div className="stat py-3">
            <dt className="stat-title text-xs">Tech level</dt>
            <dd className="stat-value text-xl">{c.techLevel == null ? '—' : `TL${c.techLevel}`}</dd>
          </div>
          <div className="stat py-3">
            <dt className="stat-title text-xs">Mana</dt>
            <dd className="stat-value text-xl">{MANA_LEVEL_LABELS[c.manaLevel ?? 'normal']}</dd>
          </div>
        </dl>
      </section>

      {/* Campaign roster — browseable from the campaign page. Member
          characters minimal viewers see deep-link to
          /characters/:id, which renders CharacterMinimalView for them. */}
      <section className="max-w-5xl space-y-2">
        <h2 className="font-display text-2xl font-semibold">Characters</h2>
        {roster === undefined ? (
          <p className="text-sm text-base-content/60">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-base-content/60">No characters in this campaign yet.</p>
        ) : (
          <ul className="grid md:grid-cols-2 gap-3">
            {roster.map((ch) => (
              <li key={ch.id} className="min-w-0">
                <CharacterCard character={ch} hideAttributes={ch.minimal} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
