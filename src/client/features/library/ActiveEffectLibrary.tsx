import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ActiveEffectDefinitionOut } from '../../../shared/schemas/activeEffects.ts';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.tsx';
import { api } from '../../lib/api.ts';
import { ActiveEffectForm } from './ActiveEffectForm.tsx';
import { effectPreview } from './EffectsEditor.tsx';
export function ActiveEffectLibrary({
  campaignId,
  entries,
  isOwner,
  search,
}: { campaignId: string; entries: ActiveEffectDefinitionOut[]; isOwner: boolean; search: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const client = useQueryClient();
  async function refreshed() {
    await client.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
    await client.invalidateQueries({ queryKey: ['campaign-library', campaignId] });
    setEditing(null);
  }
  return (
    <div className="space-y-3">
      {entries
        .filter(
          (e) =>
            e.id === editing ||
            [e.name, e.description, e.source, ...e.tags]
              .join(' ')
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .map((e) =>
          editing === e.id ? (
            <ActiveEffectForm
              key={e.id}
              initial={e}
              onCancel={() => setEditing(null)}
              onSave={async (value) => {
                await api(`/campaigns/${campaignId}/library/active-effects/${e.id}`, {
                  method: 'PATCH',
                  body: value,
                });
                await refreshed();
              }}
            />
          ) : (
            <article className="card p-card" key={e.id}>
              <h3>{e.name}</h3>
              <p>{e.description}</p>
              <p className="text-xs">
                {e.source} ·{' '}
                {e.duration.kind === 'indefinite'
                  ? 'Indefinite'
                  : `${e.duration.amount} ${e.duration.kind}`}{' '}
                · {e.stacking.kind}
              </p>
              <p>
                {e.effects.map(effectPreview).join('; ')}{' '}
                {e.capabilities.map((c) => c.label).join(', ')}
              </p>
              {isOwner && (
                <div>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(e.id)}>
                    Edit {e.name}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setDeleting(e.id)}>
                    Delete {e.name}
                  </button>
                </div>
              )}
            </article>
          ),
        )}
      {isOwner &&
        (editing === 'new' ? (
          <ActiveEffectForm
            onCancel={() => setEditing(null)}
            onSave={async (value) => {
              await api(`/campaigns/${campaignId}/library/active-effects`, {
                method: 'POST',
                body: value,
              });
              await refreshed();
            }}
          />
        ) : (
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            Add active effect
          </button>
        ))}
      {error && <p role="alert">{error}</p>}
      <ConfirmDialog
        open={!!deleting}
        title="Delete active effect definition?"
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          void api(`/campaigns/${campaignId}/library/active-effects/${deleting}`, {
            method: 'DELETE',
          })
            .then(refreshed)
            .catch((e) => setError(e.message));
          setDeleting(null);
        }}
      />
    </div>
  );
}
