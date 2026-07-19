import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useToasts } from '../../lib/toast.tsx';
import { encounterKeys, encountersApi } from './encountersApi.ts';
import { useEncounters } from './useEncounters.ts';

export function CampaignEncounterPanel({
  campaignId,
  canManage,
}: { campaignId: string; canManage: boolean }) {
  const list = useEncounters(campaignId);
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const create = useMutation({
    mutationFn: () => encountersApi.create(campaignId, { combatants: [] }),
    onSuccess: (encounter) => {
      void queryClient.invalidateQueries({ queryKey: encounterKeys.list(campaignId) });
      toasts.push('Encounter created', { kind: 'success' });
      window.location.assign(`/campaigns/${campaignId}/encounters/${encounter.id}`);
    },
    onError: () => toasts.push('Could not create encounter', { kind: 'error' }),
  });
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Encounters</h2>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            New encounter
          </button>
        )}
      </div>
      {list.isLoading ? (
        <p className="text-sm text-base-content/60">Loading encounters...</p>
      ) : null}
      {list.data?.length === 0 ? (
        <p className="text-sm text-base-content/60">No encounters yet.</p>
      ) : null}
      <EncounterList
        label="Active"
        campaignId={campaignId}
        encounters={list.data?.filter((encounter) => encounter.status === 'active') ?? []}
      />
      <EncounterList
        label="Past encounters"
        campaignId={campaignId}
        encounters={list.data?.filter((encounter) => encounter.status === 'ended') ?? []}
      />
    </section>
  );
}

function EncounterList({
  label,
  campaignId,
  encounters,
}: {
  label: string;
  campaignId: string;
  encounters: NonNullable<ReturnType<typeof useEncounters>['data']>;
}) {
  if (encounters.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-base-content/70">{label}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {encounters.map((encounter) => (
          <Link
            key={encounter.id}
            to={`/campaigns/${campaignId}/encounters/${encounter.id}`}
            className="card border border-base-300 p-3 hover:border-primary"
          >
            <span className="font-medium">{encounter.name}</span>
            <span className="text-xs text-base-content/60">
              {encounter.status === 'ended'
                ? `Ended ${encounter.endedAt ? new Date(encounter.endedAt).toLocaleDateString() : ''}`
                : `Round ${encounter.round}`}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
