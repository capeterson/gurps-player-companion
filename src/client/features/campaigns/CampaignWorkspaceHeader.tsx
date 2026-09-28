import { type ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MANA_LEVEL_LABELS } from '../../../shared/constants/magic.ts';
import { MediaImage } from '../../components/MediaImage.tsx';
import { AppIcon } from '../../components/ui/AppIcon.tsx';
import { CampaignSettingsDialog } from './CampaignSettingsDialog.tsx';
import type { CampaignWorkspace } from './useCampaignWorkspace.ts';

interface Props {
  campaignId: string;
  workspace: CampaignWorkspace;
}

function navClass(active: boolean): string {
  return `tab h-auto min-h-10 whitespace-nowrap px-3 ${active ? 'tab-active font-semibold' : ''}`;
}

export function CampaignWorkspaceHeader({ campaignId, workspace }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { campaign, remoteCampaign, viewerRole, canManage } = workspace;
  if (!campaign) return null;

  const roleLabel =
    viewerRole === 'owner' ? 'Owner' : viewerRole === 'manager' ? 'Manager' : 'Player';
  const links = [
    { label: 'Overview', to: `/campaigns/${campaignId}`, end: true, show: true },
    {
      label: 'Adventure log',
      to: `/campaigns/${campaignId}/log`,
      end: true,
      show: true,
    },
    { label: 'Library', to: `/campaigns/${campaignId}/library`, end: false, show: true },
    { label: 'History', to: `/campaigns/${campaignId}/history`, end: true, show: true },
    {
      label: 'Encounters',
      to: `/campaigns/${campaignId}/encounters`,
      end: false,
      show: campaign.experimentalTurnTracker === true,
    },
    {
      label: 'GM dashboard',
      to: `/campaigns/${campaignId}/gm`,
      end: true,
      show: canManage,
    },
  ] as const;

  return (
    <header className="card card-border overflow-hidden bg-base-100">
      <div className="card-body gap-3 p-4 sm:p-5">
        <MediaImage
          targetType="campaign"
          targetId={campaignId}
          assetId={campaign.coverAssetId}
          name={campaign.name}
          editable={viewerRole === 'owner'}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-eyebrow">Campaign workspace</p>
            <h1
              className="card-title block [overflow-wrap:anywhere] font-display text-2xl leading-tight sm:text-3xl"
              title={campaign.name}
            >
              {campaign.name}
            </h1>
            {campaign.description && (
              <p className="mt-1 max-w-prose text-sm text-base-content/60">
                {campaign.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Campaign details">
              <span className="badge badge-sm badge-outline">{roleLabel}</span>
              {campaign.techLevel != null && (
                <span className="badge badge-sm badge-outline">TL{campaign.techLevel}</span>
              )}
              <span className="badge badge-sm badge-outline">
                {MANA_LEVEL_LABELS[campaign.manaLevel ?? 'normal']}
              </span>
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={!remoteCampaign}
              title={remoteCampaign ? 'Campaign settings' : 'Connect to edit campaign settings'}
              onClick={() => setSettingsOpen(true)}
            >
              <AppIcon name="settings" size={16} />
              Settings
            </button>
          )}
        </div>
      </div>
      <nav
        aria-label="Campaign sections"
        className="tabs tabs-border overflow-x-auto border-t border-base-300 px-2 sm:px-4"
      >
        {links
          .filter((link) => link.show)
          .map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => navClass(isActive)}
            >
              {link.label}
            </NavLink>
          ))}
      </nav>
      {settingsOpen && remoteCampaign && (
        <CampaignSettingsDialog
          open
          campaign={remoteCampaign}
          viewerRole={viewerRole}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </header>
  );
}

export function CampaignPageHeading({
  title,
  description,
  actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-base-content/60">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
