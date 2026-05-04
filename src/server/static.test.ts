import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { safeJoin } from './static.ts';

const BASE = resolve('/srv/dist/client');

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
