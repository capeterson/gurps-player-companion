import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  RECYCLE_BIN_RETENTION_DAYS,
  type RecycleBinOut,
} from '../../../shared/schemas/recycleBin.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { RetypeToConfirmDialog } from '../../components/ui/RetypeToConfirmDialog.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { getSyncOrchestrator } from '../../sync/orchestrator.ts';

type Kind = 'character' | 'campaign';
interface Target {
  readonly kind: Kind;
  readonly id: string;
  readonly name: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
const reason = (err: unknown) =>
  err instanceof ApiError || err instanceof Error ? err.message : 'please try again';

/** Deleted characters and campaigns, restorable until their 30 days are up. */
export function RecycleBinPage() {
  const toasts = useToasts();
  const queryClient = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState<Target | null>(null);
  const bin = useQuery({
    queryKey: ['recycle-bin'],
    queryFn: () => api<RecycleBinOut>('/recycle-bin'),
  });

  const restore = useMutation({
    mutationFn: async (target: Target) => {
      await api(
        `/${target.kind === 'character' ? 'characters' : 'campaigns'}/${target.id}/restore`,
        {
          method: 'POST',
        },
      );
      // Bring the restored sheet or campaign back into the local mirror.
      await getSyncOrchestrator()
        .syncNow()
        .catch(() => undefined);
    },
    onSuccess: (_data, target) => {
      toasts.push(`Restored ${target.name}`, { kind: 'success' });
    },
    onError: (err, target) =>
      toasts.push(`Couldn't restore ${target.name} — ${reason(err)}`, { kind: 'error' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['recycle-bin'] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  const purge = useMutation({
    mutationFn: (target: Target) =>
      api(`/recycle-bin/${target.kind === 'character' ? 'characters' : 'campaigns'}/${target.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, target) => {
      setPurgeTarget(null);
      toasts.push(`Permanently deleted ${target.name}`, { kind: 'success' });
    },
    onError: (err, target) => {
      setPurgeTarget(null);
      toasts.push(`Couldn't delete ${target.name} — ${reason(err)}`, { kind: 'error' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['recycle-bin'] }),
  });

  const busy = restore.isPending || purge.isPending;
  const empty = bin.data && bin.data.characters.length === 0 && bin.data.campaigns.length === 0;

  function row(target: Target, deletedAt: string, purgeAfter: string, detail?: string) {
    return (
      <div
        key={`${target.kind}:${target.id}`}
        className="flex flex-col items-stretch gap-3 rounded-box border border-base-300 p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="break-words font-medium">
            {target.name}
            {detail && <span className="font-normal text-muted"> · {detail}</span>}
          </p>
          <p className="text-xs text-muted">
            Deleted {day(deletedAt)} · removed after {day(purgeAfter)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 self-end sm:self-auto">
          <button
            type="button"
            className="btn btn-sm whitespace-nowrap"
            disabled={busy}
            onClick={() => restore.mutate(target)}
          >
            Restore
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm whitespace-nowrap text-error"
            disabled={busy}
            onClick={() => setPurgeTarget(target)}
          >
            Delete now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="label-eyebrow">Account</p>
        <h1 className="font-display text-3xl">Recycle bin</h1>
        <p className="mt-1 text-sm text-muted">
          Deleted characters and campaigns are permanently removed after{' '}
          {RECYCLE_BIN_RETENTION_DAYS} days.
        </p>
      </header>

      {bin.isError && (
        <QueryReadError label="recycle bin" error={bin.error} onRetry={() => void bin.refetch()} />
      )}
      {empty && <p className="text-sm text-muted">Nothing deleted in the last 30 days.</p>}

      {bin.data && bin.data.characters.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-eyebrow">Characters</h2>
          {bin.data.characters.map((c) =>
            row({ kind: 'character', id: c.id, name: c.name }, c.deletedAt, c.purgeAfter),
          )}
        </section>
      )}

      {bin.data && bin.data.campaigns.length > 0 && (
        <section className="space-y-2">
          <h2 className="label-eyebrow">Campaigns</h2>
          {bin.data.campaigns.map((c) =>
            row(
              { kind: 'campaign', id: c.id, name: c.name },
              c.deletedAt,
              c.purgeAfter,
              `${c.characterCount} character${c.characterCount === 1 ? '' : 's'}`,
            ),
          )}
        </section>
      )}

      <ConfirmDialog
        open={purgeTarget?.kind === 'character'}
        title="Permanently delete character?"
        confirmLabel="Delete now"
        pendingLabel="Deleting…"
        tone="error"
        pending={purge.isPending}
        onConfirm={() => purgeTarget && purge.mutate(purgeTarget)}
        onCancel={() => setPurgeTarget(null)}
      >
        <p>
          <strong>{purgeTarget?.name}</strong> and everything on its sheet will be deleted for good.
          This can&apos;t be undone.
        </p>
      </ConfirmDialog>
      <RetypeToConfirmDialog
        open={purgeTarget?.kind === 'campaign'}
        title="Permanently delete campaign?"
        expectedText={purgeTarget?.name ?? ''}
        noun="campaign name"
        confirmLabel="Delete now"
        pendingLabel="Deleting…"
        pending={purge.isPending}
        onConfirm={() => purgeTarget && purge.mutate(purgeTarget)}
        onCancel={() => setPurgeTarget(null)}
      >
        <p>
          <strong>{purgeTarget?.name}</strong>, its library and its adventure log will be deleted
          for good. This can&apos;t be undone.
        </p>
      </RetypeToConfirmDialog>
    </div>
  );
}
