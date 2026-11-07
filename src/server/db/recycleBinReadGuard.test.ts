/**
 * Recycle-bin read guard.
 *
 * A binned character or campaign has `deleted_at` set and must not exist for
 * any ordinary read. Every server query that reads `characters` or `campaigns`
 * therefore has to either filter on `deletedAt`, or say, with a
 * `// recycle-bin: <reason>` comment inside the statement, why it must still
 * see binned rows (admin views, library edits that must reach binned
 * characters, lookups that follow an authorization helper that already hides
 * them). A new unreviewed query fails here until someone decides which.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SERVER = join(import.meta.dir, '..');
// System jobs that deliberately operate on every row.
const EXEMPT = new Set([
  'services/recycleBin.ts',
  'services/userPurge.ts',
  'services/preview/provision.ts',
]);
const QUERY = /\.from\((characters|campaigns)\)|[jJ]oin\((characters|campaigns)[,)]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'migrations' || name === 'seeds' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/seed/i.test(name) ? [path] : [];
  });
}

describe('recycle bin read guard', () => {
  it('every characters/campaigns query filters binned rows or says why not', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SERVER)) {
      const rel = relative(SERVER, file);
      if (EXEMPT.has(rel)) continue;
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(QUERY)) {
        const start = match.index ?? 0;
        const semicolon = source.indexOf(';', start);
        // Include the rest of the closing line so a trailing comment counts.
        const lineEnd = semicolon === -1 ? -1 : source.indexOf('\n', semicolon);
        const statement = source.slice(start, lineEnd === -1 ? undefined : lineEnd);
        if (statement.includes('deletedAt') || statement.includes('recycle-bin:')) continue;
        const line = source.slice(0, start).split('\n').length;
        offenders.push(`${rel}:${line}  ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
