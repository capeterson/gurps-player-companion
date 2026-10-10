import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon.tsx';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { getLocalDb } from '../../db/dexie.ts';
import { DRAFT_FIELD_CLASS } from '../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { useToasts } from '../../lib/toast.tsx';
import { makeFlashKey } from '../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';

type CampaignEdit = {
  characterId: string;
  from: string | null;
} & ({ stage: 'warning' | 'editing' } | { stage: 'confirm'; to: string | null });

export function CampaignAssignmentControl({
  characterId,
  campaignId,
  canWrite,
}: {
  characterId: string;
  campaignId: string | null;
  canWrite: boolean;
}) {
  const campaigns = useLiveQuery(() => getLocalDb().campaigns.toArray(), []) ?? [];
  const campaignName = (id: string | null) =>
    id === null
      ? 'No campaign'
      : (campaigns.find((campaign) => campaign.id === id)?.name ?? 'Campaign');
  const flashKey = makeFlashKey('character', characterId, 'campaignId');
  const flash = useFieldFlash(flashKey);
  const toasts = useToasts();
  const [edit, setEdit] = useState<CampaignEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const activeEdit =
    canWrite && edit?.characterId === characterId && edit.from === campaignId ? edit : null;
  const editing = activeEdit !== null && activeEdit.stage !== 'warning';

  useEffect(() => {
    void characterId;
    void campaignId;
    void canWrite;
    setEdit(null);
  }, [characterId, campaignId, canWrite]);

  const confirmCampaign = async () => {
    if (!activeEdit || activeEdit.stage !== 'confirm' || saving) return;
    setSaving(true);
    try {
      await enqueueFieldPatch({
        entityClass: 'character',
        entityId: characterId,
        fieldPath: 'campaignId',
        attemptedValue: activeEdit.to,
        humanName: 'campaign',
        flashKey,
      });
      setEdit(null);
    } catch (error) {
      toasts.push(
        `Couldn't change campaign — ${error instanceof Error ? error.message : String(error)}`,
        {
          kind: 'error',
        },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-control min-w-0">
      <span className="label-text-alt label-eyebrow">Campaign</span>
      <div
        className={`flex min-w-0 items-center gap-2 rounded ${DRAFT_FIELD_CLASS}`}
        data-flashing={flash['data-flashing']}
        data-flash-parity={flash['data-flash-parity']}
      >
        {editing ? (
          <>
            <select
              aria-label="campaign"
              className="select select-bordered select-sm min-w-0 flex-1"
              value={campaignId ?? ''}
              disabled={saving}
              onChange={(event) => {
                const next = event.target.value || null;
                if (next !== campaignId && activeEdit) {
                  setEdit({ ...activeEdit, stage: 'confirm', to: next });
                }
              }}
            >
              <option value="">No campaign</option>
              {campaignId && !campaigns.some((campaign) => campaign.id === campaignId) && (
                <option value={campaignId}>{campaignName(campaignId)}</option>
              )}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-square min-h-11 min-w-11 shrink-0"
              aria-label="Cancel editing campaign"
              disabled={saving}
              onClick={() => setEdit(null)}
            >
              <AppIcon name="close" size={18} />
            </button>
          </>
        ) : (
          <>
            {campaignId ? (
              <Link
                to={`/campaigns/${campaignId}`}
                className="link min-w-0 [overflow-wrap:anywhere]"
              >
                {campaignName(campaignId)}
              </Link>
            ) : (
              <span>No campaign</span>
            )}
            {canWrite && (
              <button
                type="button"
                className="btn btn-ghost btn-square min-h-11 min-w-11 shrink-0"
                aria-label="Edit campaign"
                disabled={saving}
                onClick={() => setEdit({ characterId, from: campaignId, stage: 'warning' })}
              >
                <AppIcon name="edit" size={18} />
              </button>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={activeEdit?.stage === 'warning'}
        title="Change character campaign?"
        confirmLabel="Continue"
        onCancel={() => setEdit(null)}
        onConfirm={() => {
          if (activeEdit?.stage === 'warning') setEdit({ ...activeEdit, stage: 'editing' });
        }}
      >
        Changing or leaving this campaign may impact your character sheet. Campaign library content
        already copied to this character will be retained, but its live links will be removed.
        Rejoining the campaign later will not restore those links, so that content will no longer
        receive campaign library updates automatically.
      </ConfirmDialog>
      <ConfirmDialog
        open={activeEdit?.stage === 'confirm'}
        title="Are you sure?"
        confirmLabel="Change campaign"
        pending={saving}
        pendingLabel="Changing campaign…"
        onCancel={() => {
          if (activeEdit?.stage === 'confirm') setEdit({ ...activeEdit, stage: 'editing' });
        }}
        onConfirm={() => void confirmCampaign()}
      >
        {activeEdit?.stage === 'confirm' && (
          <p>
            Change this character&apos;s campaign from{' '}
            <strong>{campaignName(activeEdit.from)}</strong> to{' '}
            <strong>{campaignName(activeEdit.to)}</strong>?
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
