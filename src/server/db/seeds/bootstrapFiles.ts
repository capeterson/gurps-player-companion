import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_BOOTSTRAP_DIR = new URL('../../../../bootstrap/', import.meta.url);

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Reads a file from `bootstrap/`. Source runs resolve it beside the repository;
 * the bundled production server (dist/server) falls back to the working
 * directory's `bootstrap/`, which the runtime image copies in.
 * Returns null when the file exists in neither place.
 */
export async function readBootstrapFile(relativePath: string): Promise<Buffer | null> {
  try {
    return await readFile(new URL(relativePath, SOURCE_BOOTSTRAP_DIR));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    return await readFile(resolve(process.cwd(), 'bootstrap', relativePath));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function readLanternCoastYaml(): Promise<string> {
  const bytes = await readBootstrapFile('lantern_coast.yaml');
  if (!bytes) throw new Error('bootstrap/lantern_coast.yaml is missing');
  return bytes.toString('utf8');
}
