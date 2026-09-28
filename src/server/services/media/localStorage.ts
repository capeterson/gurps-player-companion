import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { mediaConfig } from './config.ts';
import type { MediaStorage } from './storage.ts';

/** Development/CI only. The object API and sanitized bytes match S3. */
export function localMediaStorage(directory: string): MediaStorage {
  const root = resolve(directory);
  const guard = () => {
    if (mediaConfig().backend !== 'local')
      throw new Error('Local media storage is not enabled for this environment');
  };
  guard();

  function parts(key: string, prefix = false): string[] {
    const value = prefix && key.endsWith('/') ? key.slice(0, -1) : key;
    const segments = value.split('/');
    if (
      !value ||
      segments.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')
    )
      throw new Error('Invalid media object key');
    return segments;
  }

  async function path(key: string): Promise<string> {
    guard();
    const segments = parts(key);
    let current = root;
    // Object keys never follow symlinks, including the configured root.
    for (const part of ['', ...segments]) {
      if (part) current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('Media paths cannot be symlinks');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current;
  }

  return {
    async put(key, bytes) {
      const destination = await path(key);
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async get(key) {
      return new Uint8Array(await readFile(await path(key)));
    },
    async head(key) {
      return (await stat(await path(key))).size;
    },
    async remove(key) {
      const destination = await path(key);
      await rm(destination, { force: true });
      for (let parent = dirname(destination); parent !== root; parent = dirname(parent)) {
        try {
          await rmdir(parent);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') break;
          throw error;
        }
      }
    },
    async list(prefix, cursor) {
      guard();
      const segments = parts(prefix, true);
      await path(segments.join('/'));
      const base = prefix.endsWith('/') ? segments : segments.slice(0, -1);
      const keys: string[] = [];
      async function walk(relative: string) {
        const location = relative ? await path(relative) : root;
        let entries: Dirent[];
        try {
          entries = await readdir(location, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          const key = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(key);
          else if (entry.isFile() && !key.endsWith('.tmp') && key.startsWith(prefix))
            keys.push(key);
        }
      }
      await walk(base.join('/'));
      const remaining = keys.sort().filter((key) => !cursor || key > cursor);
      const page = remaining.slice(0, 1000);
      return {
        keys: page,
        ...(remaining.length > page.length ? { cursor: page[page.length - 1] } : {}),
      };
    },
  };
}
