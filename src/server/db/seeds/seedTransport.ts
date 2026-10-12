/**
 * Shared seed transport. Kept free of script entrypoints so the server bundle
 * can provision the guest preview without evaluating a seed CLI.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mediaCapabilities, mediaManifest } from '../../../shared/schemas/media.ts';
import type { createApp } from '../../app.ts';
import { readBootstrapFile } from './bootstrapFiles.ts';
import type { LanternArtworkUpload, LanternRequest } from './lanternCoastContent.ts';

const ARTWORK_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

async function readArtwork(slug: string): Promise<Buffer | null> {
  for (const extension of ARTWORK_EXTENSIONS) {
    const bytes = await readBootstrapFile(`lantern_coast_art/${slug}.${extension}`);
    if (bytes) return bytes;
  }
  return null;
}

/** Calls the API in-process as the supplied bearer, so seeds share every route guard. */
export function inProcessSeedRequest(app: ReturnType<typeof createApp>): LanternRequest {
  return async (token, path, method = 'POST', body?: unknown) => {
    const response = await app.request(`/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Lantern seed ${method} ${path}: ${response.status} ${await response.text()}`,
      );
    return response.status === 204 ? null : response.json();
  };
}

/** Optional art lives beside the YAML; absent files or disabled storage skip uploads. */
export function lanternArtworkUploader(request: LanternRequest): LanternArtworkUpload {
  let enabled: boolean | undefined;
  return async (actor, targetType, targetId, slug) => {
    const bytes = await readArtwork(slug);
    if (!bytes) return null;
    enabled ??= mediaCapabilities.parse(await request(actor, '/media/capabilities', 'GET')).enabled;
    if (!enabled) return null;
    const manifest = mediaManifest.parse(
      await request(actor, '/media/uploads', 'POST', {
        clientUploadId: randomUUID(),
        targetType,
        targetId,
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        base64: bytes.toString('base64'),
      }),
    );
    if (manifest.state !== 'ready') throw new Error(`Lantern artwork ${slug} is ${manifest.state}`);
    return manifest.id;
  };
}
