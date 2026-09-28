import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localMediaStorage } from './localStorage.ts';

const keys = ['ENVIRONMENT', 'NODE_ENV', 'MEDIA_STORAGE'] as const;
let original: Map<string, string | undefined>;
let directories: string[];

beforeEach(() => {
  original = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.ENVIRONMENT = 'test';
  process.env.NODE_ENV = 'test';
  process.env.MEDIA_STORAGE = 'local';
  directories = [];
});

afterEach(async () => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else process.env[key] = value;
  }
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'gpc-media-local-'));
  directories.push(directory);
  return directory;
}

describe('local media object storage', () => {
  it('round-trips bytes across adapter instances, lists lexically, and deletes empty parents', async () => {
    const root = await temporaryDirectory();
    const first = localMediaStorage(root);
    const key = 'images/asset-01/generation/display.webp';
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await first.put(key, bytes);
    expect(await first.head(key)).toBe(bytes.length);

    // A newly constructed adapter stands in for a process restart.
    const afterRestart = localMediaStorage(root);
    expect(await afterRestart.get(key)).toEqual(bytes);
    expect(await afterRestart.list('images/asset-01/')).toEqual({ keys: [key] });
    await afterRestart.remove(key);
    expect(await afterRestart.list('images/asset-01/')).toEqual({ keys: [] });
  });

  it('uses an exclusive lexical cursor in pages of at most 1000 object keys', async () => {
    const root = await temporaryDirectory();
    const storage = localMediaStorage(root);
    await Promise.all(
      Array.from({ length: 1001 }, (_, index) =>
        storage.put(
          `images/bulk/${String(index).padStart(4, '0')}.webp`,
          new Uint8Array([index % 255]),
        ),
      ),
    );

    const first = await storage.list('images/bulk/');
    expect(first.keys).toHaveLength(1000);
    expect(first.keys[0]).toBe('images/bulk/0000.webp');
    expect(first.keys[999]).toBe('images/bulk/0999.webp');
    expect(first.cursor).toBe(first.keys[999]);

    const second = await storage.list('images/bulk/', first.cursor);
    expect(second).toEqual({ keys: ['images/bulk/1000.webp'] });
  });

  it('rejects traversal, absolute keys, and symlinked path components', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const storage = localMediaStorage(root);

    await expect(storage.put('../outside.webp', new Uint8Array([1]))).rejects.toThrow(
      'Invalid media object key',
    );
    await expect(storage.get('/tmp/outside.webp')).rejects.toThrow('Invalid media object key');
    await expect(storage.list('../')).rejects.toThrow('Invalid media object key');

    await symlink(outside, join(root, 'linked'), 'dir');
    await expect(storage.put('linked/escape.webp', new Uint8Array([1]))).rejects.toThrow(
      'Media paths cannot be symlinks',
    );

    const symlinkedRoot = join(outside, 'root-link');
    await symlink(root, symlinkedRoot, 'dir');
    await expect(
      localMediaStorage(symlinkedRoot).put('image.webp', new Uint8Array([1])),
    ).rejects.toThrow('Media paths cannot be symlinks');
  });

  it('rechecks the environment on each operation if production is enabled after construction', async () => {
    const root = await temporaryDirectory();
    const storage = localMediaStorage(root);
    await storage.put('images/asset/display.webp', new Uint8Array([1, 2, 3]));

    process.env.ENVIRONMENT = 'production';
    await expect(storage.get('images/asset/display.webp')).rejects.toThrow(
      /forbidden in production/,
    );
    await expect(storage.put('images/asset/new.webp', new Uint8Array([4]))).rejects.toThrow(
      /forbidden in production/,
    );
    await expect(storage.list('images/')).rejects.toThrow(/forbidden in production/);
  });

  it('does not expose temporary files through listing', async () => {
    const root = await temporaryDirectory();
    const storage = localMediaStorage(root);
    await storage.put('images/asset/display.webp', new Uint8Array([1]));
    const variantDirectory = join(root, 'images', 'asset');
    const entries = await readdir(variantDirectory);
    expect(entries).toEqual(['display.webp']);
    expect((await storage.list('images/')).keys).toEqual(['images/asset/display.webp']);
  });
});
