import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExperimentalFeatures } from '../../../shared/schemas/experimentalFeatures.ts';
import { QueryReadError } from '../../components/ui/QueryReadError.tsx';
import { useDraftToggle } from '../../hooks/useDraftToggle.ts';
import { api } from '../../lib/api.ts';

function McpUiToggle({
  value,
  onSave,
}: { value: boolean; onSave: (value: boolean) => Promise<unknown> }) {
  const draft = useDraftToggle({ name: 'MCP UI', serverValue: value, onSave });
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span className="min-w-0">
        <span className="block font-medium">MCP UI</span>
        <span className="block text-xs text-muted">
          Show character sheets and focused item, container, and skill cards in compatible AI
          clients.
        </span>
      </span>
      <input
        type="checkbox"
        className="toggle toggle-sm shrink-0 field-rollback-flash"
        aria-label="MCP UI"
        checked={draft.checked}
        onChange={draft.toggle}
        {...draft.flashProps}
      />
    </label>
  );
}

export function ExperimentalFeaturesSection({ userId }: { userId: string | undefined }) {
  const qc = useQueryClient();
  const queryKey = ['experimental-features', userId];
  const preferences = useQuery({
    queryKey,
    queryFn: () => api<ExperimentalFeatures>('/auth/experimental-features'),
    enabled: Boolean(userId),
  });
  const save = async (mcpUi: boolean) => {
    await api<ExperimentalFeatures>('/auth/experimental-features', {
      method: 'PATCH',
      body: { mcpUi },
    });
    qc.setQueryData<ExperimentalFeatures>(queryKey, { mcpUi });
  };
  return (
    <section className="card gap-4 p-card">
      <div>
        <p className="label-eyebrow">Preferences</p>
        <h2 className="font-display text-2xl">Experimental Features</h2>
        <p className="mt-1 text-sm text-muted">
          Try optional features that are still in development. Off by default.
        </p>
      </div>
      {preferences.isError && (
        <QueryReadError
          label="experimental features"
          error={preferences.error}
          onRetry={() => void preferences.refetch()}
        />
      )}
      {!preferences.data && !preferences.isError && (
        <p className="text-sm text-muted">Loading experimental features…</p>
      )}
      {preferences.data && (
        <McpUiToggle key={userId} value={preferences.data.mcpUi} onSave={save} />
      )}
      <p className="text-xs text-muted">
        Saved to your account for all connected clients. Refresh your client's tools after changing
        MCP UI.
      </p>
    </section>
  );
}
