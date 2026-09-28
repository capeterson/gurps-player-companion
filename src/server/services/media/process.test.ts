import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  MEDIA_INPUT_BYTES,
  MEDIA_OUTPUT_BYTES,
  MEDIA_THUMB_BYTES,
} from '../../../shared/schemas/media.ts';
import { processImage } from './process.ts';

async function sourceImage(format: 'jpeg' | 'png' | 'webp' = 'png') {
  const image = sharp({
    create: { width: 80, height: 40, channels: 3, background: { r: 90, g: 130, b: 170 } },
  });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
}

describe('media image processing', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'converts static %s into bounded WebP variants',
    async (format) => {
      const result = await processImage(await sourceImage(format), 'character');
      const thumb = await sharp(result.thumb).metadata();
      const display = await sharp(result.display).metadata();

      expect(thumb.format).toBe('webp');
      expect(display.format).toBe('webp');
      expect(result.width).toBe(80);
      expect(result.height).toBe(40);
      expect(result.thumb.length).toBeLessThanOrEqual(MEDIA_THUMB_BYTES);
      expect(result.thumb.length + result.display.length).toBeLessThanOrEqual(MEDIA_OUTPUT_BYTES);
    },
  );

  it('applies EXIF orientation and drops source metadata when it re-encodes', async () => {
    const oriented = await sharp({
      create: { width: 80, height: 40, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'private test metadata' } } })
      .toBuffer();

    const result = await processImage(oriented, 'character');
    const output = await sharp(result.display).metadata();

    expect(result.width).toBe(40);
    expect(result.height).toBe(80);
    expect(output.exif).toBeUndefined();
    expect(output.xmp).toBeUndefined();
    expect(output.iptc).toBeUndefined();
  });

  it('rejects invalid bytes, unsupported formats, and oversized declarations', async () => {
    await expect(processImage(new Uint8Array([1, 2, 3]), 'character')).rejects.toThrow();
    await expect(
      processImage(Buffer.from('<svg><script>alert(1)</script></svg>'), 'character'),
    ).rejects.toThrow();
    await expect(processImage(new Uint8Array(MEDIA_INPUT_BYTES + 1), 'character')).rejects.toThrow(
      'Image must be at most 10 MiB',
    );
  });

  it('rejects images just beyond the maximum dimension even when their pixel count is small', async () => {
    const image = await sharp({
      create: { width: 12001, height: 1, channels: 3, background: { r: 20, g: 30, b: 40 } },
    })
      .png()
      .toBuffer();
    await expect(processImage(image, 'character')).rejects.toThrow(
      'Image exceeds the 40 megapixel or 12,000 pixel limit',
    );
  });

  it('rejects animated WebP input', async () => {
    const animated = Buffer.from(
      'UklGRsQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAGQAAAJWUDggMgAAADABAJ0BKgIAAgABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkYAAAAAAAAAAAABAAABAABkAAAAVlA4IC4AAAA0AQCdASoCAAIAAAAmJaAAA3AA/vtV4///S4P/+lwf/9Lg/9Lg//rV5Vesq6AA',
      'base64',
    );
    const metadata = await sharp(animated, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);
    await expect(processImage(animated, 'character')).rejects.toThrow(
      'Choose a static JPEG, PNG, or WebP image',
    );
  });

  it('uses the larger cover variants while preserving source proportions', async () => {
    const source = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 80, g: 120, b: 160 } },
    })
      .png()
      .toBuffer();
    const result = await processImage(source, 'campaign');

    expect(result.width).toBe(1920);
    expect(result.height).toBe(960);
    expect(result.thumb.length + result.display.length).toBeLessThanOrEqual(MEDIA_OUTPUT_BYTES);
  });
});
