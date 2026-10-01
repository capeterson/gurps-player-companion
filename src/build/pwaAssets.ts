/** Deterministic installation assets derived from the existing brand artwork. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Plugin } from 'vite';

interface IconAsset {
  fileName: string;
  url: string;
  bytes: Buffer;
}

export async function createPwaAssets(publicDir: string) {
  const source = await readFile(join(publicDir, 'icon-512.png'));
  const { data, info } = await sharp(source)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
  // Fit all visible artwork inside Android's circular safe zone (radius 40%).
  // Leave another 2% for resampling. Merely adding a 10% rectangular inset
  // would still crop the book's lower corners under a circular launcher mask.
  let artworkRadius = 1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (
        Math.abs((data[offset] ?? 0) - background.r) > 8 ||
        Math.abs((data[offset + 1] ?? 0) - background.g) > 8 ||
        Math.abs((data[offset + 2] ?? 0) - background.b) > 8
      ) {
        artworkRadius = Math.max(
          artworkRadius,
          Math.hypot(x - (info.width - 1) / 2, y - (info.height - 1) / 2),
        );
      }
    }
  }
  const maskSize = Math.min(512, Math.floor((info.width * 512 * 0.38) / artworkRadius));
  const maskArtwork = await sharp(source).resize(maskSize, maskSize).removeAlpha().png().toBuffer();
  const maskable = await sharp({ create: { width: 512, height: 512, channels: 3, background } })
    .composite([{ input: maskArtwork, gravity: 'centre' }])
    .removeAlpha()
    .png()
    .toBuffer();

  function asset(name: string, bytes: Buffer): IconAsset {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const fileName = `assets/${name}-${hash}.png`;
    return { fileName, url: `/${fileName}`, bytes };
  }

  const regular192 = asset('app-icon-192', await readFile(join(publicDir, 'icon-192.png')));
  const regular512 = asset('app-icon-512', source);
  const adaptive512 = asset('app-icon-maskable-512', maskable);
  const apple180 = asset(
    'apple-touch-icon-180',
    await sharp(source).resize(180, 180).png().toBuffer(),
  );
  const favicon32 = asset('favicon-32', await sharp(source).resize(32, 32).png().toBuffer());
  const assets = [regular192, regular512, adaptive512, apple180, favicon32];

  const plugin: Plugin = {
    name: 'gpc-pwa-assets',
    generateBundle() {
      for (const icon of assets) {
        this.emitFile({ type: 'asset', fileName: icon.fileName, source: icon.bytes });
      }
    },
    // The same HTML also runs under Vite development, without a service worker.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const icon = assets.find((candidate) => candidate.url === req.url?.split('?')[0]);
        if (!icon) return next();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(icon.bytes);
      });
    },
    transformIndexHtml(html) {
      return html
        .replace('href="/icon-256.png"', `href="${favicon32.url}"`)
        .replace('sizes="256x256"', 'sizes="32x32"')
        .replace('href="/icon-192.png"', `sizes="180x180" href="${apple180.url}"`);
    },
  };

  return {
    plugin,
    assets,
    icons: [
      { src: regular192.url, sizes: '192x192', type: 'image/png', purpose: 'any' as const },
      { src: regular512.url, sizes: '512x512', type: 'image/png', purpose: 'any' as const },
      { src: adaptive512.url, sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    ],
  };
}
