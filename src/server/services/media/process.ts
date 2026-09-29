import { HTTPException } from 'hono/http-exception';
import sharp from 'sharp';
import {
  MEDIA_INPUT_BYTES,
  MEDIA_OUTPUT_BYTES,
  MEDIA_THUMB_BYTES,
  type MediaTarget,
} from '../../../shared/schemas/media.ts';

// Restrict native decoding before metadata inspection: checking metadata.format
// afterwards would still expose every installed parser to untrusted uploads.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
  operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer', 'VipsForeignLoadWebpBuffer'],
});

let busy = false;
export async function processImage(bytes: Uint8Array, target: MediaTarget) {
  if (busy) throw new HTTPException(503, { message: 'Image processor is busy; retry shortly' });
  busy = true;
  try {
    if (!bytes.length || bytes.length > MEDIA_INPUT_BYTES)
      throw new Error('Image must be at most 10 MiB');
    const input = Buffer.from(bytes);
    const options = { limitInputPixels: 40_000_000, failOn: 'warning' as const, animated: true };
    const metadata = await sharp(input, options).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
      throw new Error('Choose a static JPEG, PNG, or WebP image');
    if (
      !metadata.width ||
      !metadata.height ||
      Math.max(metadata.width, metadata.height) > 12000 ||
      metadata.width * metadata.height > 40_000_000
    )
      throw new Error('Image exceeds the 40 megapixel or 12,000 pixel limit');
    const variant = async (size: number) =>
      sharp(input, options)
        .rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .webp({ quality: 80 })
        .timeout({ seconds: 10 })
        .toBuffer({ resolveWithObject: true });
    const thumb = await variant(target === 'character' ? 256 : 640);
    const display = await variant(target === 'character' ? 1024 : 1920);
    if (
      thumb.data.length > MEDIA_THUMB_BYTES ||
      thumb.data.length + display.data.length > MEDIA_OUTPUT_BYTES
    )
      throw new Error('Image is too detailed; choose a smaller or simpler image');
    return {
      thumb: thumb.data,
      display: display.data,
      width: display.info.width,
      height: display.info.height,
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(422, {
      message: error instanceof Error ? error.message : 'Image could not be decoded',
    });
  } finally {
    busy = false;
  }
}
