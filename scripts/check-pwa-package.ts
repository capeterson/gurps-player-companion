/** Build gate: inspect the shipped package, rather than only the Vite inputs. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve('dist/client');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const admin = await readFile(resolve(root, 'admin.html'), 'utf8');
const worker = await readFile(resolve(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(
  (html.match(/rel="manifest"/g) ?? []).length,
  1,
  'Player HTML needs one manifest link',
);
assert(!admin.includes('rel="manifest"'), 'Admin HTML must not link the player manifest');
assert(!admin.includes('registerSW'), 'Admin HTML must not register a worker');
assert(!/url:"(?:admin\.html|assets\/admin-)/.test(worker), 'Admin must not be precached');
assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.lang, 'en');

for (const [size, purpose] of [
  [192, 'any'],
  [512, 'any'],
  [512, 'maskable'],
] as const) {
  const icon = manifest.icons.find(
    (candidate: { sizes: string; purpose: string }) =>
      candidate.sizes === `${size}x${size}` && candidate.purpose === purpose,
  );
  assert(icon, `Missing ${size}px ${purpose} installation icon`);
  assert.match(icon.src, /^\/assets\/app-icon-[\w-]+-[a-f0-9]{8}\.png$/);
  const path = icon.src.slice(1);
  const metadata = await sharp(await readFile(resolve(root, path))).metadata();
  assert.equal(metadata.width, size);
  assert.equal(metadata.height, size);
  assert.equal(metadata.format, 'png');
  assert(!metadata.hasAlpha, 'Installation icons must be opaque');
  assert(worker.includes(path), `${path} must be precached`);
}
for (const [rel, size] of [
  ['icon', 32],
  ['apple-touch-icon', 180],
] as const) {
  const link = html.match(new RegExp(`<link rel="${rel}"[^>]*href="([^"]+)"`));
  assert(link?.[1], `Missing ${rel}`);
  const path = link[1].slice(1);
  const metadata = await sharp(await readFile(resolve(root, path))).metadata();
  assert.equal(metadata.width, size);
  assert.equal(metadata.height, size);
  assert(worker.includes(path), `${rel} must be precached`);
}
assert(manifest.screenshots.some((shot: { form_factor: string }) => shot.form_factor === 'narrow'));
assert(manifest.screenshots.some((shot: { form_factor: string }) => shot.form_factor === 'wide'));
for (const shot of manifest.screenshots) {
  const metadata = await sharp(await readFile(resolve(root, shot.src.slice(1)))).metadata();
  assert.equal(shot.sizes, `${metadata.width}x${metadata.height}`);
}
console.log('PWA package verified: identity, icons, screenshots, precache, and admin isolation.');
