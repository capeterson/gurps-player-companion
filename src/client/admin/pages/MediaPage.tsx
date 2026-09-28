import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';

interface Asset {
  id: string;
  uploaderId: string | null;
  uploadsDisabled: boolean;
  previewUrl: string | null;
  targetType: string;
  targetId: string;
  state: string;
  bytes: number;
  createdAt: string;
}
export function MediaPage() {
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string>();
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const list = useQuery({
    queryKey: ['admin', 'media', offset],
    queryFn: () => api<Asset[]>(`/admin/media?offset=${offset}`),
  });
  async function act(path: string, method: 'DELETE' | 'PATCH', body?: unknown) {
    setBusy(true);
    try {
      await api(path, { method, ...(body ? { body } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
      setConfirm(undefined);
      toasts.push('Media setting saved', { kind: 'success' });
    } catch (error) {
      toasts.push(error instanceof Error ? error.message : 'Media action failed', {
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl">Uploaded images</h1>
      <p className="text-sm">
        Takedown removes the image from the app and stops origin delivery. Browser and public cache
        copies may remain.
      </p>
      {list.isLoading && <output>Loading images…</output>}
      {list.error && (
        <p role="alert" className="alert alert-error">
          {list.error.message}
        </p>
      )}
      {list.data?.length === 0 && <p>No uploaded images.</p>}
      {list.data?.map((asset) => (
        <article key={asset.id} className="card card-border bg-base-100">
          <div className="card-body break-words">
            <h2 className="card-title text-base">
              {asset.targetType === 'character' ? 'Character portrait' : 'Campaign cover'} ·{' '}
              {asset.state}
            </h2>
            {asset.previewUrl && (
              <img
                src={asset.previewUrl}
                alt={`${asset.targetType} upload preview`}
                className="h-32 w-32 rounded-box object-cover"
                width={128}
                height={128}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
            <p className="text-sm">
              Image {asset.id} · {(asset.bytes / 1024).toFixed(0)} KiB
            </p>
            <p className="text-xs">
              Uploader: {asset.uploaderId ?? 'Deleted account'} ·{' '}
              {new Date(asset.createdAt).toLocaleString()}
            </p>
            <div className="card-actions">
              {confirm === asset.id ? (
                <>
                  <span>Remove this image?</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void act(`/admin/media/${asset.id}`, 'DELETE')}
                  >
                    Confirm takedown
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setConfirm(undefined)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy || asset.state === 'cancelled' || asset.state === 'deleting'}
                  onClick={() => setConfirm(asset.id)}
                >
                  Take down image
                </button>
              )}
              {asset.uploaderId && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void act(`/admin/media/users/${asset.uploaderId}`, 'PATCH', {
                      disabled: !asset.uploadsDisabled,
                    })
                  }
                >
                  {asset.uploadsDisabled
                    ? 'Enable uploader’s uploads'
                    : 'Disable uploader’s uploads'}
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={(list.data?.length ?? 0) < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
