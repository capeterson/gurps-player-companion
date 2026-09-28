import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { type MediaTarget, mediaField } from '../../shared/schemas/media.ts';
import { getLocalDb } from '../db/dexie.ts';
import { useFlashState } from '../hooks/useFlashState.ts';
import { api } from '../lib/api.ts';
import { useToasts } from '../lib/toast.tsx';
import { enqueueImage, removeImage, retryImage } from '../sync/mediaUploads.ts';

interface Props {
  targetType: MediaTarget;
  targetId: string;
  assetId?: string | null | undefined;
  editable?: boolean;
  thumbnail?: boolean;
  name: string;
}

export function MediaImage({
  targetType,
  targetId,
  assetId,
  editable = false,
  thumbnail = false,
  name,
}: Props) {
  const db = getLocalDb();
  const model = useLiveQuery(async () => {
    const row =
      targetType === 'character'
        ? await db.characters.get(targetId)
        : await db.campaigns.get(targetId);
    const current = row
      ? ((row as unknown as Record<string, unknown>)[mediaField(targetType)] as
          | string
          | null
          | undefined)
      : assetId;
    const uploads = await db.mediaUploads.where('targetId').equals(targetId).toArray();
    const pending = uploads.find((u) => u.id === current || u.assetId === current);
    const failed = uploads.filter((u) => u.state === 'failed');
    const manifest = current ? await db.mediaManifests.get(current) : undefined;
    const capabilities = await db.syncMeta.get('media:capabilities');
    return { current, pending, failed, manifest, enabled: capabilities?.value === true };
  }, [targetType, targetId, assetId]);
  const [preview, setPreview] = useState<string>();
  const [broken, setBroken] = useState<string[]>([]);
  useEffect(() => {
    if (!broken.length) return;
    const retry = () => setBroken([]);
    const timer = window.setTimeout(retry, 30_000);
    window.addEventListener('online', retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, [broken.length]);
  const toasts = useToasts();
  const label = targetType === 'character' ? 'Portrait' : 'Campaign cover';
  const flash = useFlashState(`${targetType}:${targetId}:${mediaField(targetType)}`);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!editable) return;
    const controller = new AbortController();
    void api<{ enabled: boolean }>('/media/capabilities', { signal: controller.signal })
      .then(async (c) => {
        await db.transaction('rw', db.syncMeta, async () => {
          if (!controller.signal.aborted)
            await db.syncMeta.put({ key: 'media:capabilities', value: c.enabled });
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [editable, db]);
  const blob = model?.pending?.state !== 'failed' ? model?.pending?.blob : undefined;
  useEffect(() => {
    if (!blob) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const desired = thumbnail ? model?.manifest?.thumbUrl : model?.manifest?.displayUrl;
  const src = [preview, desired, model?.manifest?.thumbUrl].find(
    (url): url is string => Boolean(url) && !broken.includes(url as string),
  );
  const commit = (fn: () => Promise<unknown>) => {
    writes.current = writes.current
      .then(fn)
      .then(() => undefined)
      .catch((error) => {
        toasts.push(
          `Couldn't save ${label} — ${error instanceof Error ? error.message : 'local storage failed'}`,
          { kind: 'error' },
        );
        flash.trigger();
      });
  };
  if (!editable && !model?.current && !assetId) return null;
  const shape =
    targetType === 'campaign'
      ? 'aspect-[3/1] w-full'
      : thumbnail
        ? 'h-14 w-14'
        : 'h-48 w-48 max-w-full';
  return (
    <div
      className={`min-w-0 space-y-2 ${editable ? 'field-rollback-flash rounded-box' : ''}`}
      {...flash.flashProps}
    >
      {(model?.current || assetId) && (
        <div className={`${shape} overflow-hidden rounded-box bg-base-200`}>
          {src ? (
            <img
              src={src}
              srcSet={
                !preview &&
                !thumbnail &&
                src === desired &&
                model?.manifest?.thumbUrl &&
                !broken.includes(model.manifest.thumbUrl) &&
                (model.manifest.width ?? 0) > (targetType === 'character' ? 256 : 640)
                  ? `${model.manifest.thumbUrl} ${targetType === 'character' ? 256 : 640}w, ${src} ${model.manifest.width ?? 1024}w`
                  : undefined
              }
              sizes={targetType === 'character' ? '192px' : '(max-width: 768px) 100vw, 960px'}
              width={model?.manifest?.width ?? 256}
              height={model?.manifest?.height ?? 256}
              alt={`${name} ${targetType === 'character' ? 'portrait' : 'cover'}`}
              className="h-full w-full object-cover"
              loading={thumbnail ? 'lazy' : 'eager'}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => {
                const current = event.currentTarget.currentSrc;
                const failed =
                  current && !current.startsWith('blob:')
                    ? new URL(current, window.location.href).pathname
                    : src;
                setBroken((previous) => [...previous, failed]);
              }}
            />
          ) : (
            <span className="flex h-full items-center justify-center p-2 text-center text-xs text-base-content/60">
              Image unavailable
            </span>
          )}
        </div>
      )}
      {editable && (
        <>
          {model?.enabled ? (
            <label className="block space-y-1 text-sm">
              <span>{label}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label={`Upload ${label.toLowerCase()}`}
                className="file-input file-input-sm w-full max-w-sm"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) commit(() => enqueueImage(targetType, targetId, file));
                }}
              />
            </label>
          ) : (
            <p className="text-sm text-base-content/60">
              Image uploads are unavailable on this server.
            </p>
          )}
          {model?.current && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => commit(() => removeImage(targetType, targetId))}
            >
              Remove {label.toLowerCase()}
            </button>
          )}
          {model?.pending && model.pending.state !== 'failed' && (
            <output className="text-sm">
              {model.pending.state === 'queued'
                ? 'Image queued for upload'
                : model.pending.state === 'uploading'
                  ? 'Uploading and processing image…'
                  : 'Saving image…'}
              {model.pending.state === 'queued' &&
                model.pending.reason &&
                ` — Waiting to retry: ${model.pending.reason}`}
            </output>
          )}
          {model?.failed?.map((upload) => (
            <div key={upload.id} className="space-y-1 text-sm">
              <p role="alert">
                Couldn't save {label} — {upload.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => commit(() => retryImage(upload))}
                >
                  Retry image
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => commit(() => db.mediaUploads.delete(upload.id))}
                >
                  Discard failed image
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    const url = URL.createObjectURL(upload.blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'unsaved-image';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download unsaved image
                </button>
              </div>
            </div>
          ))}
          {model?.enabled && (
            <p className="max-w-prose text-xs text-base-content/60">
              JPEG, PNG or WebP, up to 10 MiB. Upload only images you may share. Anyone with an
              image link can view it; cached copies may remain after removal.
            </p>
          )}
        </>
      )}
    </div>
  );
}
