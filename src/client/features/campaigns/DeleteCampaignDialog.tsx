/**
 * Owner-only campaign deletion dialog. Deleting moves the campaign to the
 * recycle bin, so a plain confirmation is enough; permanently deleting it from
 * the bin keeps the retype-name gate.
 */

import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';

export function DeleteCampaignDialog({
  open,
  campaignName,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  campaignName: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Delete campaign?"
      confirmLabel="Delete campaign"
      pendingLabel="Deleting…"
      tone="error"
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <strong>{campaignName}</strong> moves to the recycle bin and is permanently deleted after 30
        days. Members lose access and its characters leave the campaign; restoring it brings them
        back.
      </p>
    </ConfirmDialog>
  );
}
