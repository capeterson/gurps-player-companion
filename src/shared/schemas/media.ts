import { z } from 'zod';
import { uuid } from './common.ts';

export const MEDIA_INPUT_BYTES = 10 * 1024 * 1024;
export const MEDIA_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MEDIA_THUMB_BYTES = 128 * 1024;
export const MEDIA_LOCAL_BYTES = 50 * 1024 * 1024;
export const mediaTarget = z.enum(['character', 'campaign']);
export type MediaTarget = z.infer<typeof mediaTarget>;
export const mediaVariant = z.enum(['thumb', 'display']);
export const mediaInitialize = z
  .object({
    clientUploadId: uuid,
    targetType: mediaTarget,
    targetId: uuid,
    byteLength: z.number().int().min(1).max(MEDIA_INPUT_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const mediaContent = z
  .object({
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MEDIA_INPUT_BYTES / 3))
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export const mediaManifest = z.object({
  id: uuid,
  state: z.enum(['pending', 'processing', 'ready', 'cancelled', 'deleting', 'rejected']),
  thumbUrl: z.string().nullable(),
  displayUrl: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  reason: z.string().nullable(),
});
export type MediaManifest = z.infer<typeof mediaManifest>;
export const mediaCapabilities = z.object({ enabled: z.boolean(), maxInputBytes: z.number() });
export const campaignMediaPatch = z.object({ coverAssetId: uuid.nullable().optional() }).strict();
export function mediaField(target: MediaTarget): 'portraitAssetId' | 'coverAssetId' {
  return target === 'character' ? 'portraitAssetId' : 'coverAssetId';
}
