/**
 * Owner-only campaign deletion dialog with the same retype-name gate
 * as TransferOwnershipDialog — both are thin wrappers around the
 * shared RetypeToConfirmDialog shell.
 */

import { RetypeToConfirmDialog } from '../../components/ui/RetypeToConfirmDialog.tsx';

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
    <RetypeToConfirmDialog
      open={open}
      title="Delete campaign?"
      expectedText={campaignName}
      confirmLabel="Delete campaign"
      pendingLabel="Deleting…"
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <strong>{campaignName}</strong> and all of its memberships will be removed for everyone.
        Characters in it will become campaign-less. This cannot be undone from the UI.
      </p>
    </RetypeToConfirmDialog>
  );
}
