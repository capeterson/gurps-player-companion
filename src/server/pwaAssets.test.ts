import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createPwaAssets } from '../build/pwaAssets.ts';

describe('PWA installation artwork', () => {
  it('preserves regular icons and fits opaque adaptive artwork inside the circular safe zone', async () => {
    const pwa = await createPwaAssets(resolve('public'));
    expect(pwa.icons.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
    for (const asset of pwa.assets) {
      const hash = createHash('sha256').update(asset.bytes).digest('hex').slice(0, 8);
      expect(asset.url).toContain(`-${hash}.png`);
      const metadata = await sharp(asset.bytes).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(metadata.height);
      expect(metadata.hasAlpha).toBe(false);
    }
    expect(pwa.assets[0]?.bytes).toEqual(await readFile('public/icon-192.png'));
    expect(pwa.assets[1]?.bytes).toEqual(await readFile('public/icon-512.png'));
    const adaptive = pwa.assets.find((asset) => asset.fileName.includes('maskable'));
    expect(adaptive).toBeDefined();
    const { data, info } = await sharp(adaptive?.bytes).raw().toBuffer({ resolveWithObject: true });
    let artworkPixels = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        const foreground = [0, 1, 2].some(
          (channel) => Math.abs((data[offset + channel] ?? 0) - (data[channel] ?? 0)) > 8,
        );
        if (!foreground) continue;
        artworkPixels++;
        expect(Math.hypot(x - 255.5, y - 255.5)).toBeLessThanOrEqual(512 * 0.4);
      }
    }
    expect(artworkPixels).toBeGreaterThan(20_000);
    for (const [name, size] of [
      ['apple-touch-icon', 180],
      ['favicon', 32],
    ] as const) {
      const asset = pwa.assets.find((candidate) => candidate.fileName.includes(name));
      expect((await sharp(asset?.bytes).metadata()).width).toBe(size);
    }
  });

  it('changes installation icon URLs when the source artwork changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gpc-pwa-artwork-'));
    try {
      for (const size of [192, 512]) {
        await writeFile(join(dir, `icon-${size}.png`), await readFile(`public/icon-${size}.png`));
      }
      const before = await createPwaAssets(dir);
      const changed = await sharp(await readFile(join(dir, 'icon-512.png')))
        .modulate({ brightness: 0.8 })
        .png()
        .toBuffer();
      await writeFile(join(dir, 'icon-512.png'), changed);
      const after = await createPwaAssets(dir);
      expect(after.icons[0]?.src).toBe(before.icons[0]?.src);
      expect(after.icons[1]?.src).not.toBe(before.icons[1]?.src);
      expect(after.icons[2]?.src).not.toBe(before.icons[2]?.src);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
