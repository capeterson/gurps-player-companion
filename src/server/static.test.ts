import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeJoin, shouldRevalidateStaticPath } from './static.ts';

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

describe('app icon assets', () => {
  it('ships opaque PWA sizes and the exact compact plugin icon', () => {
    for (const size of [192, 256, 512]) {
      const icon = pngMetadata(resolve(`public/icon-${size}.png`));
      expect(icon.width).toBe(size);
      expect(icon.height).toBe(size);
      expect(icon.hasTransparencyChunk).toBe(false);
    }

    const publicIcon = pngMetadata(resolve('public/icon-256.png')).bytes;
    const pluginIcon = pngMetadata(
      resolve('plugins/gurps-player-companion-dev/assets/icon-256.png'),
    ).bytes;
    expect(publicIcon.byteLength).toBeLessThan(10_000);
    expect(pluginIcon.equals(publicIcon)).toBe(true);
  });
});
