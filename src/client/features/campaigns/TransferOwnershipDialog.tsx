/**
 * Owner-only confirmation modal for transferring ownership to another
 * member.  The user has to retype the campaign name to enable the
 * destructive button — the same paranoia gate DeleteCampaignDialog
 * uses, via the shared RetypeToConfirmDialog shell.
 */

import type { CampaignMemberOut } from '../../../shared/schemas/campaign.ts';
import { RetypeToConfirmDialog } from '../../components/ui/RetypeToConfirmDialog.tsx';

export function TransferOwnershipDialog({
  open,
  campaignName,
  target,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  campaignName: string;
  target: CampaignMemberOut | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <RetypeToConfirmDialog
      open={open}
      title="Transfer campaign ownership?"
      expectedText={campaignName}
      confirmLabel="Transfer ownership"
      pendingLabel="Transferring…"
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <strong>{target?.displayName}</strong> will become the owner. You will lose owner privileges
        and become a regular member. This cannot be undone unless the new owner transfers it back.
      </p>
    </RetypeToConfirmDialog>
  );
}
