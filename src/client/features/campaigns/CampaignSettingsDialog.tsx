/**
 * Campaign settings modal — owners edit rules; managers manage members.
 * Lets the GM tune point
 * target, disadvantage / quirk caps, and toggle whether character
 * sheets are shared with other members.
 *
 * Patches go through the standard `/campaigns/{id}` PATCH; on
 * success we invalidate the `['campaigns']` query so the list and
 * any open character sheet (which reads the campaign's
 * `shareCharacterSheets` flag) re-render.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { MANA_LEVELS, MANA_LEVEL_LABELS, type ManaLevel } from '../../../shared/constants/magic.ts';
import {
  HOUSE_RULE_DEFINITIONS,
  type NumberHouseRuleDefinition,
  type NumberHouseRuleKey,
  applyHouseRuleSet,
  customizeHouseRule,
  isNumberHouseRule,
} from '../../../shared/domain/campaignRules.ts';
import { campaignHouseRules } from '../../../shared/schemas/campaign.ts';
import type {
  CampaignHouseRules,
  CampaignMemberOut,
  CampaignOut,
  CampaignRole,
  CampaignUpdate,
  HouseRuleSet,
  TransferOwnershipRequest,
} from '../../../shared/schemas/campaign.ts';
import { MediaImage } from '../../components/MediaImage.tsx';
import type { LocalCampaign } from '../../db/dexie.ts';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { journalCampaignMutation } from '../../sync/onlineMutationLog.ts';
import { CampaignInvitePanel } from './CampaignInvitePanel.tsx';
import { CampaignMembersPanel } from './CampaignMembersPanel.tsx';
import { DeleteCampaignDialog } from './DeleteCampaignDialog.tsx';
import { TransferOwnershipDialog } from './TransferOwnershipDialog.tsx';

interface Props {
  open: boolean;
  campaign: CampaignOut | LocalCampaign;
  onlineAvailable?: boolean;
  /** Role of the viewer in this campaign — owner or manager unlocks invitations. */
  viewerRole: CampaignRole;
  onClose: () => void;
}

function houseRuleNumberFromInput(s: string, rule: NumberHouseRuleDefinition): number | null {
  const t = s.trim();
  const n = Number(t);
  return t !== '' && Number.isInteger(n) && n >= rule.min && n <= rule.max ? n : null;
}

function nullableIntFromInput(s: string): number | null | 'invalid' {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'invalid';
  return n;
}

export function CampaignSettingsDialog({
  open,
  campaign,
  viewerRole,
  onlineAvailable = true,
  onClose,
}: Props) {
  const [section, setSection] = useState<'campaign' | 'rules' | 'members'>(
    viewerRole === 'owner' ? 'campaign' : 'members',
  );
  const canEditSettings = viewerRole === 'owner' && onlineAvailable;
  const members = 'members' in campaign ? campaign.members : [];
  const ref = useDialogState(open);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toasts = useToasts();
  const qc = useQueryClient();

  const [pointTarget, setPointTarget] = useState(
    campaign.pointTarget == null ? '' : String(campaign.pointTarget),
  );
  const [disadCap, setDisadCap] = useState(
    campaign.disadvantageCap == null ? '' : String(campaign.disadvantageCap),
  );
  const [quirkCap, setQuirkCap] = useState(
    campaign.quirkCap == null ? '' : String(campaign.quirkCap),
  );
  const [manaLevel, setManaLevel] = useState<ManaLevel>(campaign.manaLevel ?? 'normal');
  const [techLevel, setTechLevel] = useState(
    campaign.techLevel == null ? '' : String(campaign.techLevel),
  );
  const [enforceAttributeCaps, setEnforceAttributeCaps] = useState(
    campaign.enforceAttributeCaps ?? true,
  );
  const [shareSheets, setShareSheets] = useState(campaign.shareCharacterSheets ?? true);
  const [allowGmEditing, setAllowGmEditing] = useState(campaign.allowGmCharacterEditing ?? false);
  const [skillPrerequisitePolicy, setSkillPrerequisitePolicy] = useState(
    campaign.skillPrerequisitePolicy ?? 'block',
  );
  const [experimentalActiveEffects, setExperimentalActiveEffects] = useState(
    campaign.experimentalActiveEffects ?? false,
  );
  const [experimentalTurnTracker, setExperimentalTurnTracker] = useState(
    campaign.experimentalTurnTracker ?? false,
  );
  const [houseRules, setHouseRules] = useState<CampaignHouseRules>(() =>
    campaignHouseRules.parse(campaign.houseRules ?? {}),
  );
  // Raw text of numeric house rules being typed; valid values also update houseRules.
  const [houseRuleDrafts, setHouseRuleDrafts] = useState<
    Partial<Record<NumberHouseRuleKey, string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<CampaignMemberOut | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editingCampaign = useRef<{ id: string; remoteHydrated: boolean } | null>(null);

  // Each time the dialog opens with a (potentially) new campaign,
  // hydrate the local form state.  Without this, reopening for
  // campaign B would still show campaign A's draft values.
  useEffect(() => {
    if (!open) {
      editingCampaign.current = null;
      return;
    }
    const sameCampaign = editingCampaign.current?.id === campaign.id;
    // Local settings cannot be edited until the remote campaign is loaded.
    // Hydrate once at that transition, then preserve every subsequent draft.
    if (sameCampaign && (editingCampaign.current?.remoteHydrated || !onlineAvailable)) return;
    editingCampaign.current = { id: campaign.id, remoteHydrated: onlineAvailable };
    setPointTarget(campaign.pointTarget == null ? '' : String(campaign.pointTarget));
    setDisadCap(campaign.disadvantageCap == null ? '' : String(campaign.disadvantageCap));
    setQuirkCap(campaign.quirkCap == null ? '' : String(campaign.quirkCap));
    setManaLevel(campaign.manaLevel ?? 'normal');
    setTechLevel(campaign.techLevel == null ? '' : String(campaign.techLevel));
    setEnforceAttributeCaps(campaign.enforceAttributeCaps ?? true);
    setShareSheets(campaign.shareCharacterSheets ?? true);
    setAllowGmEditing(campaign.allowGmCharacterEditing ?? false);
    setSkillPrerequisitePolicy(campaign.skillPrerequisitePolicy ?? 'block');
    setExperimentalActiveEffects(campaign.experimentalActiveEffects ?? false);
    setExperimentalTurnTracker(campaign.experimentalTurnTracker ?? false);
    setHouseRules(campaignHouseRules.parse(campaign.houseRules ?? {}));
    setHouseRuleDrafts({});
    setError(null);
    if (!sameCampaign) setSection(viewerRole === 'owner' ? 'campaign' : 'members');
  }, [open, campaign, viewerRole, onlineAvailable]);

  const update = useMutation({
    mutationFn: (body: CampaignUpdate) =>
      journalCampaignMutation(
        {
          entityId: campaign.id,
          command: 'patch',
          method: 'PATCH',
          path: `/campaigns/${campaign.id}`,
          body,
          before: { ...campaign },
          source: 'Campaign settings',
          humanName: 'campaign rules updated',
        },
        () => api<CampaignOut>(`/campaigns/${campaign.id}`, { method: 'PATCH', body }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toasts.push('Settings saved', { kind: 'success' });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    },
  });

  const transfer = useMutation({
    mutationFn: (newOwnerId: string) =>
      journalCampaignMutation(
        {
          entityId: campaign.id,
          command: 'patch',
          method: 'POST',
          path: `/campaigns/${campaign.id}/transfer`,
          body: { newOwnerId },
          before: { ...campaign },
          source: 'Campaign ownership',
          humanName: 'ownership transferred',
        },
        () =>
          api<CampaignOut>(`/campaigns/${campaign.id}/transfer`, {
            method: 'POST',
            body: { newOwnerId } satisfies TransferOwnershipRequest,
          }),
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setTransferTarget(null);
      onClose();
      toasts.push(
        `Ownership transferred to ${data.members.find((m) => m.userId === data.ownerId)?.displayName ?? 'new owner'}`,
        { kind: 'success' },
      );
    },
    onError: (err) =>
      toasts.push(err instanceof ApiError ? err.message : 'Transfer failed', { kind: 'error' }),
  });

  const remove = useMutation({
    mutationFn: () =>
      journalCampaignMutation(
        {
          entityId: campaign.id,
          command: 'delete',
          method: 'DELETE',
          path: `/campaigns/${campaign.id}`,
          before: { ...campaign },
          source: 'Campaign deletion',
          humanName: 'campaign deleted',
        },
        () => api<void>(`/campaigns/${campaign.id}`, { method: 'DELETE' }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setConfirmDelete(false);
      onClose();
      toasts.push(`Deleted ${campaign.name}`, { kind: 'success' });
    },
    onError: (err) => {
      setConfirmDelete(false);
      toasts.push(err instanceof ApiError ? err.message : 'Delete failed', { kind: 'error' });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditSettings || update.isPending) return;
    setError(null);
    const pt = nullableIntFromInput(pointTarget);
    const dc = nullableIntFromInput(disadCap);
    const qcVal = nullableIntFromInput(quirkCap);
    const tl = nullableIntFromInput(techLevel);
    if (pt === 'invalid' || dc === 'invalid' || qcVal === 'invalid' || tl === 'invalid') {
      setSection('campaign');
      setError('Caps, point target, and tech level must be non-negative integers (or blank).');
      return;
    }
    const invalidRule = HOUSE_RULE_DEFINITIONS.filter(isNumberHouseRule).find((rule) => {
      const draft = houseRuleDrafts[rule.key];
      return draft !== undefined && houseRuleNumberFromInput(draft, rule) === null;
    });
    if (invalidRule) {
      setSection('rules');
      setError(
        `${invalidRule.label} must be a whole number from ${invalidRule.min} to ${invalidRule.max}${invalidRule.unit}.`,
      );
      return;
    }
    update.mutate({
      pointTarget: pt,
      disadvantageCap: dc,
      quirkCap: qcVal,
      manaLevel,
      techLevel: tl,
      enforceAttributeCaps,
      shareCharacterSheets: shareSheets,
      allowGmCharacterEditing: allowGmEditing,
      skillPrerequisitePolicy,
      experimentalTurnTracker,
      experimentalActiveEffects,
      houseRules,
    });
  };

  if (!open) return null;

  return (
    <>
      <dialog
        ref={ref}
        onClose={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        className="modal"
        aria-labelledby="campaign-settings-title"
      >
        <form
          method="dialog"
          className="campaign-settings-dialog modal-box flex max-h-[calc(var(--dialog-viewport-height,100dvh)_-_1rem)] w-[60rem] max-w-[calc(var(--dialog-viewport-width,100dvw)_-_1rem)] flex-col overflow-hidden p-0"
          onSubmit={onSubmit}
        >
          <header className="campaign-settings-dialog__header flex shrink-0 items-start justify-between gap-3 px-4 pt-5 pb-4 sm:px-7">
            <div className="min-w-0">
              <p className="campaign-settings-dialog__label label-eyebrow">Campaign settings</p>
              <h2
                id="campaign-settings-title"
                className="campaign-settings-dialog__header-name font-display text-2xl font-semibold [overflow-wrap:anywhere]"
              >
                {campaign.name}
              </h2>
            </div>
            <button
              type="button"
              className="campaign-settings-dialog__close btn btn-ghost btn-square shrink-0"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <nav
            aria-label="Settings sections"
            className="campaign-settings-dialog__sections flex shrink-0 flex-wrap gap-1 border-b border-base-300 px-4 pb-3 sm:px-7"
          >
            {[
              ...(viewerRole === 'owner' ? [{ id: 'campaign' as const, label: 'Campaign' }] : []),
              { id: 'rules' as const, label: 'Rules' },
              { id: 'members' as const, label: 'Members' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`btn btn-sm ${section === item.id ? 'btn-active' : 'btn-ghost'}`}
                aria-pressed={section === item.id}
                aria-controls={`settings-${item.id}`}
                onClick={() => {
                  setSection(item.id);
                  if (bodyRef.current) bodyRef.current.scrollTop = 0;
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div
            ref={bodyRef}
            className="campaign-settings-dialog__body min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7"
          >
            <h2 className="campaign-settings-dialog__context mb-3 break-words text-base font-semibold">
              {campaign.name}
            </h2>
            {!onlineAvailable && (
              <p className="alert mb-5 text-sm">
                Connect to change campaign rules or manage members. Cover changes can still queue on
                this device.
              </p>
            )}
            <section
              id="settings-campaign"
              aria-label="Campaign preferences"
              hidden={section !== 'campaign'}
              className="space-y-6"
            >
              {viewerRole === 'owner' && (
                <section className="space-y-3" aria-labelledby="settings-cover-title">
                  <div>
                    <h3 id="settings-cover-title" className="text-lg font-semibold">
                      Campaign cover
                    </h3>
                  </div>
                  <MediaImage
                    targetType="campaign"
                    targetId={campaign.id}
                    assetId={campaign.coverAssetId}
                    name={campaign.name}
                    editable
                  />
                </section>
              )}
              <fieldset
                disabled={!canEditSettings || update.isPending}
                className="min-w-0 space-y-4 border-t border-base-300 pt-4"
              >
                <legend className="text-lg font-semibold">Character creation &amp; play</legend>
                {viewerRole === 'owner' && (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <label className="form-control min-w-0 gap-1.5">
                      <span className="label-text text-xs">Point target</span>
                      <input
                        className="input w-full min-w-0 num"
                        value={pointTarget}
                        onChange={(e) => setPointTarget(e.target.value)}
                        placeholder="—"
                      />
                    </label>
                    <label className="form-control min-w-0 gap-1.5">
                      <span className="label-text text-xs">Disadv. cap</span>
                      <input
                        className="input w-full min-w-0 num"
                        value={disadCap}
                        onChange={(e) => setDisadCap(e.target.value)}
                        placeholder="—"
                      />
                    </label>
                    <label className="form-control min-w-0 gap-1.5">
                      <span className="label-text text-xs">Quirk cap</span>
                      <input
                        className="input w-full min-w-0 num"
                        value={quirkCap}
                        onChange={(e) => setQuirkCap(e.target.value)}
                        placeholder="—"
                      />
                    </label>
                    <label className="form-control min-w-0 gap-1.5">
                      <span className="label-text text-xs">Tech level</span>
                      <input
                        className="input w-full min-w-0 num"
                        value={techLevel}
                        onChange={(e) => setTechLevel(e.target.value)}
                        placeholder="—"
                      />
                    </label>
                  </div>
                )}

                {viewerRole === 'owner' && (
                  <label className="form-control min-w-0 gap-1.5">
                    <span className="label-text text-xs">Mana level</span>
                    <select
                      className="select w-full"
                      value={manaLevel}
                      onChange={(e) => setManaLevel(e.target.value as ManaLevel)}
                    >
                      {MANA_LEVELS.map((m) => (
                        <option key={m} value={m}>
                          {MANA_LEVEL_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    <span className="label-text-alt text-xs text-base-content/60">
                      Low mana is −5 to every spell; high or better lets non-mages cast. Very high
                      mana requires energy up front, restores mages' personal FP spent casting on
                      their own turn next turn, and makes every failure critical. Applied to every
                      character sheet in this campaign.
                    </span>
                  </label>
                )}

                {viewerRole === 'owner' && (
                  <label className="form-control min-w-0 gap-1.5">
                    <span className="label-text text-xs">Skill prerequisites</span>
                    <select
                      className="select w-full"
                      value={skillPrerequisitePolicy}
                      onChange={(event) =>
                        setSkillPrerequisitePolicy(event.target.value as 'block' | 'warn')
                      }
                    >
                      <option value="block">Block unmet prerequisites</option>
                      <option value="warn">Warn only</option>
                    </select>
                  </label>
                )}

                {viewerRole === 'owner' && (
                  <label className="cursor-pointer flex items-start gap-3 pt-2 border-t border-base-300">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={enforceAttributeCaps}
                      onChange={(e) => setEnforceAttributeCaps(e.target.checked)}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">Enforce attribute caps</span>
                      <span className="block text-xs text-base-content/60">
                        Caps purchased DX, IQ, and HT at 20, and purchased Will and Per at 20 total.
                        ST and temporary bonuses remain uncapped (B14-B16).
                      </span>
                    </span>
                  </label>
                )}

                {viewerRole === 'owner' && (
                  <label className="cursor-pointer flex items-start gap-3 pt-2 border-t border-base-300">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={shareSheets}
                      onChange={(e) => setShareSheets(e.target.checked)}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">Share character sheets</span>
                      <span className="block text-xs text-base-content/60">
                        When off, fellow members see only "readily apparent" details (name, height,
                        weight, age, appearance, TL) instead of the full sheet. The owner and you
                        (the GM) always see the full sheet.
                      </span>
                    </span>
                  </label>
                )}

                {viewerRole === 'owner' && (
                  <label className="cursor-pointer flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-0.5"
                      checked={allowGmEditing}
                      onChange={(e) => setAllowGmEditing(e.target.checked)}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">Allow GM character editing</span>
                      <span className="block text-xs text-base-content/60">
                        Lets campaign owners and managers edit player-owned character sheets.
                        Players still control their own sheets, and all changes remain visible in
                        history.
                      </span>
                    </span>
                  </label>
                )}
              </fieldset>
            </section>
            <section
              id="settings-rules"
              aria-label="Campaign rules"
              hidden={section !== 'rules'}
              className="space-y-6"
            >
              <fieldset
                className="min-w-0 space-y-4"
                disabled={!canEditSettings || update.isPending}
              >
                <legend className="text-lg font-semibold">House rules</legend>
                <label className="form-control gap-1.5">
                  <span className="label-text text-xs">House rule set</span>
                  <select
                    className="select w-full"
                    aria-label="House rule set"
                    value={houseRules.ruleSet}
                    onChange={(e) => {
                      setHouseRuleDrafts({});
                      setHouseRules((current) =>
                        applyHouseRuleSet(current, e.target.value as HouseRuleSet),
                      );
                    }}
                  >
                    <option value="none">None</option>
                    <option value="j_talisar">J Talisar</option>
                    <option value="custom">Custom</option>
                  </select>
                  <span className="label-text-alt text-xs text-base-content/60">
                    Named sets load their complete bundle. Choose Custom to edit the current bundle;
                    none of its options are reset.
                  </span>
                </label>

                {(['General', 'Combat', 'Magic', 'Path magic', 'Campaign content'] as const).map(
                  (group) => (
                    <details
                      key={group}
                      open={group === 'Combat'}
                      className="collapse collapse-arrow rounded-box border border-base-300 bg-base-200/30"
                    >
                      <summary className="collapse-title font-semibold">{group}</summary>
                      <div className="collapse-content space-y-4">
                        {HOUSE_RULE_DEFINITIONS.filter((rule) => rule.group === group).map(
                          (rule) =>
                            isNumberHouseRule(rule) ? (
                              <label key={rule.key} className="form-control min-w-0 gap-1.5">
                                <span className="block text-sm font-medium">{rule.label}</span>
                                <span className="join w-32">
                                  <input
                                    className="input join-item w-full min-w-0 num"
                                    inputMode="numeric"
                                    aria-label={rule.label}
                                    value={
                                      houseRuleDrafts[rule.key] ?? String(houseRules[rule.key])
                                    }
                                    disabled={houseRules.ruleSet !== 'custom'}
                                    onChange={(e) => {
                                      const text = e.target.value;
                                      setHouseRuleDrafts((current) => ({
                                        ...current,
                                        [rule.key]: text,
                                      }));
                                      const value = houseRuleNumberFromInput(text, rule);
                                      if (value !== null)
                                        setHouseRules((current) =>
                                          customizeHouseRule(current, rule.key, value),
                                        );
                                    }}
                                  />
                                  <span className="join-item flex items-center border border-base-300 bg-base-200 px-3 text-sm">
                                    {rule.unit}
                                  </span>
                                </span>
                                <span className="block text-xs text-base-content/60">
                                  {rule.description}
                                </span>
                              </label>
                            ) : (
                              <label key={rule.key} className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="checkbox checkbox-sm mt-0.5"
                                  checked={houseRules[rule.key]}
                                  disabled={houseRules.ruleSet !== 'custom'}
                                  onChange={(e) =>
                                    setHouseRules((current) =>
                                      customizeHouseRule(current, rule.key, e.target.checked),
                                    )
                                  }
                                />
                                <span>
                                  <span className="block text-sm font-medium">{rule.label}</span>
                                  <span className="block text-xs text-base-content/60">
                                    {rule.description}
                                  </span>
                                </span>
                              </label>
                            ),
                        )}
                      </div>
                    </details>
                  ),
                )}
              </fieldset>

              <fieldset
                disabled={!canEditSettings || update.isPending}
                className="min-w-0 border-t border-base-300 pt-3"
              >
                <legend className="label-eyebrow">Experimental features</legend>
                <label className="flex items-start gap-3 pt-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-0.5"
                    checked={experimentalActiveEffects}
                    onChange={(e) => setExperimentalActiveEffects(e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium">Enable active effects</span>
                    <span className="block text-xs text-base-content/60">
                      Unfinished, experimental tools for active effects and conditional modifiers.
                      Off by default. Turning this off hides the tools and stops their bonuses;
                      saved effects and definitions are kept.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 pt-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mt-0.5"
                    checked={experimentalTurnTracker}
                    onChange={(e) => setExperimentalTurnTracker(e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium">Enable turn tracker</span>
                    <span className="block text-xs text-base-content/60">
                      Unfinished, experimental tools for campaign encounters and character turn
                      tracking. Off by default. Turning this off keeps saved encounters and local
                      tracker data.
                    </span>
                  </span>
                </label>
              </fieldset>
            </section>
            <section
              id="settings-members"
              aria-label="Campaign membership"
              hidden={section !== 'members'}
              className="space-y-5"
            >
              <p className="text-sm text-base-content/60">
                Invitations, role changes, and ownership actions take effect immediately.
              </p>

              {onlineAvailable &&
                'members' in campaign &&
                (viewerRole === 'owner' || viewerRole === 'manager') && (
                  <>
                    <CampaignMembersPanel campaign={campaign} viewerRole={viewerRole} />
                    <CampaignInvitePanel campaignId={campaign.id} viewerRole={viewerRole} />
                  </>
                )}

              {viewerRole === 'owner' && onlineAvailable && (
                <section className="border-t border-base-300 pt-3 mt-1 space-y-2">
                  <p className="label-eyebrow">Danger zone</p>
                  <div className="flex flex-wrap gap-2">
                    <details className="w-full">
                      <summary className="btn btn-ghost btn-xs">Transfer ownership ▾</summary>
                      <ul className="menu mt-2 max-h-[min(14rem,50dvh)] w-full [overflow-wrap:anywhere] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2">
                        {members.filter((m) => m.userId !== campaign.ownerId).length === 0 && (
                          <li className="text-xs text-base-content/60 px-2 py-1">
                            No other members yet.
                          </li>
                        )}
                        {members
                          .filter((m) => m.userId !== campaign.ownerId)
                          .sort((a, b) => a.displayName.localeCompare(b.displayName))
                          .map((m) => (
                            <li key={m.userId}>
                              <button
                                type="button"
                                onClick={() => setTransferTarget(m)}
                                disabled={transfer.isPending}
                              >
                                {m.displayName}
                                <span className="text-xs text-base-content/60">{m.role}</span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </details>
                    <button
                      type="button"
                      className="btn btn-error btn-outline btn-xs"
                      onClick={() => setConfirmDelete(true)}
                      disabled={remove.isPending}
                    >
                      Delete campaign…
                    </button>
                  </div>
                </section>
              )}
            </section>
          </div>
          <footer className="campaign-settings-dialog__footer shrink-0 border-t border-base-300 px-4 py-3 sm:px-7">
            {error && (
              <p role="alert" className="alert alert-error mb-3 text-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              {canEditSettings && (
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={update.isPending}
                >
                  {update.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </footer>
        </form>
      </dialog>
      <TransferOwnershipDialog
        open={transferTarget !== null}
        campaignName={campaign.name}
        target={transferTarget}
        pending={transfer.isPending}
        onConfirm={() => {
          if (transferTarget) transfer.mutate(transferTarget.userId);
        }}
        onCancel={() => setTransferTarget(null)}
      />
      <DeleteCampaignDialog
        open={confirmDelete}
        campaignName={campaign.name}
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
