/**
 * Guard 2 — audit write-path enforcement.
 *
 * Two checks:
 *   (a) Source guard: every campaign/sync mutating route file must import
 *       `withAudit` and must NOT contain bare `getDb().insert(`, `getDb().update(`,
 *       or `getDb().delete(` write calls (which would bypass the GUC).
 *       Reads (select) on getDb() are allowed.
 *   (b) Schema test: withAudit exports the expected types.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../../..');

function readRoute(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

const MUTATING_ROUTE_FILES = [
  'src/server/services/syncDispatch.ts',
  'src/server/routes/campaigns.ts',
  'src/server/routes/adventureLog.ts',
  'src/server/routes/campaignLibrary.ts',
  'src/server/routes/invitations.ts',
  'src/server/routes/characters.ts',
  'src/server/routes/characterSubResources.ts',
];

/**
 * Return lines that contain a bare `getDb().insert(`, `.update(`, or `.delete(`
 * call (i.e. NOT inside a `withAudit` block). We approximate this by looking
 * for the pattern on the same line — this won't catch multi-line chains, but
 * the style in these files is single-chain-per-statement.
 *
 * We explicitly allow `getDb().select(` (reads) and inline comments.
 */
function findBareWrites(source: string, filename: string): string[] {
  const violations: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip blank lines and comments
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
    // Check for bare getDb() write calls
    if (/getDb\(\)\.(insert|update|delete)\(/.test(line)) {
      violations.push(`  ${filename}:${i + 1}: ${line.trim()}`);
    }
  }
  return violations;
}

describe('audit context — source guard', () => {
  it('mutating route files import withAudit', () => {
    for (const rel of MUTATING_ROUTE_FILES) {
      const source = readRoute(rel);
      const hasImport =
        source.includes('import { withAudit') ||
        source.includes("withAudit } from '../db/auditContext") ||
        source.includes("withAudit } from '../../db/auditContext");
      // syncDispatch has a different relative path
      const hasSyncImport = source.includes("from '../db/auditContext");
      expect(
        hasImport || hasSyncImport,
        `${rel} does not import withAudit from auditContext. All mutating route files must wrap their DB writes in withAudit().`,
      ).toBe(true);
    }
  });

  it('mutating route files have no bare getDb().write() calls', () => {
    const allViolations: string[] = [];
    for (const rel of MUTATING_ROUTE_FILES) {
      const source = readRoute(rel);
      const violations = findBareWrites(source, rel);
      allViolations.push(...violations);
    }
    expect(
      allViolations,
      `Found bare getDb().insert/update/delete calls outside withAudit:\n${allViolations.join('\n')}\n\nWrap these writes in withAudit(actorId, batchId, async (tx) => { ... }) so the Postgres trigger can capture actor_user_id.`,
    ).toHaveLength(0);
  });
});

describe('audit context — module exports', () => {
  it('withAudit is a function (requires DB env)', async () => {
    // Skip when drizzle-orm is not resolvable (outside Docker/CI DB environment).
    let mod: { withAudit: unknown } | null = null;
    try {
      mod = await import('../db/auditContext.ts');
    } catch {
      console.log('Skipping withAudit import test: drizzle-orm not available in this env');
      return;
    }
    expect(typeof mod.withAudit).toBe('function');
  });
});
