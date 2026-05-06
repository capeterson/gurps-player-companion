/**
 * Campaign settings modal — owner-only. Lets the GM tune point
 * target, disadvantage / quirk caps, and toggle whether character
 * sheets are shared with other members.
 *
 * Patches go through the standard `/campaigns/{id}` PATCH; on
 * success we invalidate the `['campaigns']` query so the list and
 * any open character sheet (which reads the campaign's
 * `shareCharacterSheets` flag) re-render.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  CampaignMemberOut,
  CampaignOut,
  CampaignRole,
  CampaignUpdate,
  TransferOwnershipRequest,
} from '../../../shared/schemas/campaign.ts';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { CampaignInvitePanel } from './CampaignInvitePanel.tsx';
import { CampaignMembersPanel } from './CampaignMembersPanel.tsx';
import { DeleteCampaignDialog } from './DeleteCampaignDialog.tsx';
import { TransferOwnershipDialog } from './TransferOwnershipDialog.tsx';

interface Props {
  open: boolean;
  campaign: CampaignOut;
  /** Role of the viewer in this campaign — owner or manager unlocks invitations. */
  viewerRole: CampaignRole;
  onClose: () => void;
}

function nullableIntFromInput(s: string): number | null | 'invalid' {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 'invalid';
  return n;
}

export function CampaignSettingsDialog({ open, campaign, viewerRole, onClose }: Props) {
  const ref = useDialogState(open);
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
  const [shareSheets, setShareSheets] = useState(campaign.shareCharacterSheets);
  const [error, setError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<CampaignMemberOut | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Each time the dialog opens with a (potentially) new campaign,
  // hydrate the local form state.  Without this, reopening for
  // campaign B would still show campaign A's draft values.
  useEffect(() => {
    if (!open) return;
    setPointTarget(campaign.pointTarget == null ? '' : String(campaign.pointTarget));
    setDisadCap(campaign.disadvantageCap == null ? '' : String(campaign.disadvantageCap));
    setQuirkCap(campaign.quirkCap == null ? '' : String(campaign.quirkCap));
    setShareSheets(campaign.shareCharacterSheets);
    setError(null);
  }, [open, campaign]);

  const update = useMutation({
    mutationFn: (body: CampaignUpdate) =>
      api<CampaignOut>(`/campaigns/${campaign.id}`, { method: 'PATCH', body }),
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
      api<CampaignOut>(`/campaigns/${campaign.id}/transfer`, {
        method: 'POST',
        body: { newOwnerId } satisfies TransferOwnershipRequest,
      }),
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
    mutationFn: () => api<void>(`/campaigns/${campaign.id}`, { method: 'DELETE' }),
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
    setError(null);
    const pt = nullableIntFromInput(pointTarget);
    const dc = nullableIntFromInput(disadCap);
    const qcVal = nullableIntFromInput(quirkCap);
    if (pt === 'invalid' || dc === 'invalid' || qcVal === 'invalid') {
      setError('Caps and point target must be non-negative integers (or blank).');
      return;
    }
    update.mutate({
      pointTarget: pt,
      disadvantageCap: dc,
      quirkCap: qcVal,
      shareCharacterSheets: shareSheets,
    });
  };

  if (!open) return null;

  return (
    <>
      <dialog
        ref={ref}
        onClose={onClose}
        className="modal-back"
        aria-labelledby="campaign-settings-title"
      >
        <form
          method="dialog"
          className="card relative w-[28rem] max-w-[calc(100vw-3rem)] p-5 gap-3"
          onSubmit={onSubmit}
        >
          <header className="flex items-baseline justify-between">
            <div>
              <p className="label-eyebrow">Campaign settings</p>
              <h2 id="campaign-settings-title" className="font-display text-2xl font-semibold">
                {campaign.name}
              </h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <div className="grid grid-cols-3 gap-2">
            <label className="form-control">
              <span className="label-text text-xs">Point target</span>
              <input
                className="input input-bordered input-sm num"
                value={pointTarget}
                onChange={(e) => setPointTarget(e.target.value)}
                placeholder="—"
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Disadv. cap</span>
              <input
                className="input input-bordered input-sm num"
                value={disadCap}
                onChange={(e) => setDisadCap(e.target.value)}
                placeholder="—"
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Quirk cap</span>
              <input
                className="input input-bordered input-sm num"
                value={quirkCap}
                onChange={(e) => setQuirkCap(e.target.value)}
                placeholder="—"
              />
            </label>
          </div>

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
                When off, fellow members see only "readily apparent" details (name, height, weight,
                age, appearance, TL) instead of the full sheet. The owner and you (the GM) always
                see the full sheet.
              </span>
            </span>
          </label>

          {error && <p className="alert alert-error text-sm">{error}</p>}

          {(viewerRole === 'owner' || viewerRole === 'manager') && (
            <>
              <CampaignMembersPanel campaign={campaign} viewerRole={viewerRole} />
              <CampaignInvitePanel campaignId={campaign.id} viewerRole={viewerRole} />
            </>
          )}

          {viewerRole === 'owner' && (
            <section className="border-t border-base-300 pt-3 mt-1 space-y-2">
              <p className="label-eyebrow">Danger zone</p>
              <div className="flex flex-wrap gap-2">
                <details className="dropdown">
                  <summary className="btn btn-ghost btn-xs">Transfer ownership ▾</summary>
                  <ul className="menu dropdown-content z-30 mt-1 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg max-h-56 overflow-y-auto">
                    {campaign.members.filter((m) => m.userId !== campaign.ownerId).length === 0 && (
                      <li className="text-xs text-base-content/60 px-2 py-1">
                        No other members yet.
                      </li>
                    )}
                    {campaign.members
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

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
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
