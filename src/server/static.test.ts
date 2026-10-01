import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { attachStaticHandler, safeJoin, shouldRevalidateStaticPath } from './static.ts';
import { integrationTestConfig } from './testConfig.ts';

const BASE = resolve('/srv/dist/client');

function pngMetadata(path: string): {
  bytes: Buffer;
  width: number;
  height: number;
  hasTransparencyChunk: boolean;
} {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let hasTransparencyChunk = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') hasTransparencyChunk = true;
    offset += length + 12;
  }
  return {
    bytes,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasTransparencyChunk,
  };
}

describe('safeJoin', () => {
  it('accepts a normal asset path', () => {
    const out = safeJoin(BASE, '/index.html');
    expect(out).toBe(resolve(BASE, 'index.html'));
  });

  it('accepts the base directory itself', () => {
    const out = safeJoin(BASE, '/');
    expect(out).not.toBeNull();
    // The exact form may include a trailing slash on POSIX; what matters
    // is that it resolves to the base directory and isn't outside it.
    expect(resolve(out as string)).toBe(BASE);
  });

  it('rejects parent-traversal segments', () => {
    expect(safeJoin(BASE, '/../../etc/passwd')).toBeNull();
  });

  it('rejects sibling directories that share a prefix', () => {
    // `/srv/dist/client-private/secret.txt` would have passed the old
    // `startsWith('/srv/dist/client')` guard.  The relative-path check
    // catches it because `relative(BASE, joined)` starts with `..`.
    expect(safeJoin(BASE, '/../client-private/secret.txt')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(safeJoin(BASE, '/foo\0bar')).toBeNull();
  });

  it('rejects malformed percent-encoding', () => {
    // %ZZ is not valid percent-encoding -> decodeURIComponent throws.
    expect(safeJoin(BASE, '/%ZZ')).toBeNull();
  });
});

describe('static cache policy', () => {
  it('forces mutable worker, app-shell, and icon entrypoints to revalidate', () => {
    expect(shouldRevalidateStaticPath('/sw.js')).toBe(true);
    expect(shouldRevalidateStaticPath('/registerSW.js')).toBe(true);
    expect(shouldRevalidateStaticPath('/manifest.webmanifest')).toBe(true);
    expect(shouldRevalidateStaticPath('/index.html')).toBe(true);
    expect(shouldRevalidateStaticPath('/admin.html')).toBe(true);
    expect(shouldRevalidateStaticPath('/icon-192.png')).toBe(true);
    expect(shouldRevalidateStaticPath('/icon-256.png')).toBe(true);
    expect(shouldRevalidateStaticPath('/icon-512.png')).toBe(true);
  });

  it('leaves content-hashed assets cacheable', () => {
    expect(shouldRevalidateStaticPath('/assets/main-QpTixWqe.js')).toBe(false);
  });
});

describe('static HTTP response security and cache headers', () => {
  const clientRoot = mkdtempSync(join(tmpdir(), 'gpc-static-http-'));
  mkdirSync(join(clientRoot, 'assets'));
  writeFileSync(join(clientRoot, 'index.html'), '<!doctype html><main>shell</main>');
  writeFileSync(join(clientRoot, 'admin.html'), '<!doctype html><main>admin shell</main>');
  writeFileSync(join(clientRoot, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(clientRoot, 'assets', 'main-Ab1Cd2Ef.js'), 'export const build = 1;');
  writeFileSync(join(clientRoot, 'assets', 'helper.js'), 'export const helper = true;');

  const app = createApp({ ...integrationTestConfig, environment: 'development' });
  app.get('/__test/error', () => {
    throw new Error('test error');
  });
  attachStaticHandler(app, clientRoot);

  afterAll(() => rmSync(clientRoot, { recursive: true, force: true }));

  function expectFramingBlocked(response: Response) {
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  }

  it('sets frame protection on API success, API errors, and handled server errors', async () => {
    const success = await app.request('/api/v1/healthz');
    expect(success.status).toBe(200);
    expectFramingBlocked(success);

    const apiError = await app.request('/api/v1/not-a-route');
    expect(apiError.status).toBe(404);
    expect(await apiError.json()).toEqual({ error: 'not_found' });
    expectFramingBlocked(apiError);

    const serverError = await app.request('/__test/error');
    expect(serverError.status).toBe(500);
    expect(await serverError.json()).toEqual({ error: 'internal_error' });
    expectFramingBlocked(serverError);
  });

  it('serves a real hashed asset as immutable while shell, worker, and SPA fallback revalidate', async () => {
    const asset = await app.request('/assets/main-Ab1Cd2Ef.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('export const build = 1;');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expectFramingBlocked(asset);

    const unhashedAsset = await app.request('/assets/helper.js');
    expect(unhashedAsset.status).toBe(200);
    expect(await unhashedAsset.text()).toBe('export const helper = true;');
    expect(unhashedAsset.headers.get('cache-control')).toBeNull();
    expectFramingBlocked(unhashedAsset);

    for (const [path, content] of [
      ['/index.html', '<!doctype html><main>shell</main>'],
      ['/sw.js', 'self.addEventListener("fetch", () => {});'],
      ['/characters/01a0ea9d-0000-7000-8000-000000000001', '<!doctype html><main>shell</main>'],
      ['/admin/people', '<!doctype html><main>admin shell</main>'],
    ] as const) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(content);
      expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
      expectFramingBlocked(response);
    }
  });

  it('returns uncached 404s for missing package assets instead of HTML', async () => {
    for (const path of [
      '/assets/missing-Ab1Cd2Ef.js',
      '/assets/app-icon-512-Ab1Cd2Ef.png',
      '/screenshots/missing.png',
      '/manifest.webmanifest',
      '/icon-512.png',
      `/media/${'f'.repeat(64)}/thumb.webp`,
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expectFramingBlocked(response);
    }
  });
});

describe('app icon assets', () => {
  it('ships opaque PWA icon sizes with a compact 256px asset', () => {
    for (const size of [192, 256, 512]) {
      const icon = pngMetadata(resolve(`public/icon-${size}.png`));
      expect(icon.width).toBe(size);
      expect(icon.height).toBe(size);
      expect(icon.hasTransparencyChunk).toBe(false);
    }

    const publicIcon = pngMetadata(resolve('public/icon-256.png')).bytes;
    expect(publicIcon.byteLength).toBeLessThan(10_000);
  });
});
