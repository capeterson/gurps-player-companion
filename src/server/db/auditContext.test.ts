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
 * Find the index of the `)` that closes the `(` at `openParenIndex`,
 * skipping over parens inside string/template literals and comments so a
 * stray `)` in an error message or template expression doesn't throw off
 * the depth count.
 */
function findMatchingParenEnd(source: string, openParenIndex: number): number {
  let depth = 0;
  const n = source.length;
  for (let i = openParenIndex; i < n; i++) {
    const ch = source[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          // Template expression: skip its balanced braces so parens inside
          // (e.g. a nested call) aren't counted against the outer depth.
          i += 2;
          let braceDepth = 1;
          while (i < n && braceDepth > 0) {
            if (source[i] === '{') braceDepth++;
            else if (source[i] === '}') braceDepth--;
            i++;
          }
          continue;
        }
        if (source[i] === quote) break;
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    }
  }
  return -1;
}

/**
 * Blank out every `withAudit(...)` call (keeping newlines, so line numbers
 * of anything after it stay correct) so that legitimate `tx.insert/update/
 * delete` calls inside the callback never get scanned below.
 */
function maskWithAuditCalls(source: string): string {
  const re = /\bwithAudit\s*\(/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null = re.exec(source);
  while (match) {
    const openIdx = match.index + match[0].length - 1;
    const closeIdx = findMatchingParenEnd(source, openIdx);
    const end = closeIdx === -1 ? source.length - 1 : closeIdx;
    result += source.slice(lastIndex, match.index);
    result += source.slice(match.index, end + 1).replace(/[^\n]/g, ' ');
    lastIndex = end + 1;
    re.lastIndex = lastIndex;
    match = re.exec(source);
  }
  result += source.slice(lastIndex);
  return result;
}

/** Collect `const <name> = getDb()` / `let <name> = getDb()` alias bindings. */
function findGetDbAliases(source: string): string[] {
  const aliases = new Set<string>();
  const re = /\b(?:const|let)\s+(\w+)\s*=\s*getDb\(\)/g;
  let m: RegExpExecArray | null = re.exec(source);
  while (m) {
    aliases.add(m[1] as string);
    m = re.exec(source);
  }
  return Array.from(aliases);
}

/**
 * Return lines with a bare write call — `getDb().insert(`, `.update(`, or
 * `.delete(`, or the same through a `const db = getDb()` alias — outside of
 * a `withAudit(...)` callback. Catches multi-line chains (`db\n  .update(`)
 * and aliasing, not just the single-line `getDb().insert(` shape.
 *
 * `getDb().select(` (reads) are explicitly allowed, as is any `tx.*` call
 * inside a `withAudit` callback (masked out before scanning).
 */
function findBareWrites(source: string, filename: string): string[] {
  const violations: string[] = [];
  const masked = maskWithAuditCalls(source);
  const aliases = findGetDbAliases(source);
  const targets = ['getDb\\(\\)', ...aliases];
  const pattern = new RegExp(
    `\\b(?:${targets.join('|')})\\s*\\.\\s*(insert|update|delete)\\s*\\(`,
    'g',
  );
  const sourceLines = source.split('\n');
  let m: RegExpExecArray | null = pattern.exec(masked);
  while (m) {
    const line = masked.slice(0, m.index).split('\n').length;
    const lineText = (sourceLines[line - 1] ?? '').trim();
    violations.push(`  ${filename}:${line}: ${lineText}`);
    m = pattern.exec(masked);
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

describe('audit context — source guard regression', () => {
  it('flags a bare write through a `const db = getDb()` alias', () => {
    const source = `
      async function handler() {
        const db = getDb();
        await db.update(characters).set({ name: 'x' }).where(eq(characters.id, id));
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(1);
  });

  it('flags a bare multi-line getDb() write chain (no alias)', () => {
    const source = `
      async function handler() {
        await getDb()
          .update(characters)
          .set({ name: 'x' })
          .where(eq(characters.id, id));
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(1);
  });

  it('flags a bare multi-line write through an alias', () => {
    const source = `
      async function handler() {
        const db = getDb();
        await db
          .update(characters)
          .set({ name: 'x' })
          .where(eq(characters.id, id));
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(1);
  });

  it('does not flag getDb().select() reads', () => {
    const source = `
      async function handler() {
        const db = getDb();
        const rows = await db.select().from(characters).where(eq(characters.id, id));
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(0);
  });

  it('does not flag tx writes inside a single-expression withAudit callback', () => {
    const source = `
      async function handler() {
        await withAudit(user.id, undefined, (tx) =>
          tx.update(characters).set({ name: 'x' }).where(eq(characters.id, id)),
        );
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(0);
  });

  it('does not flag tx writes inside a block-bodied withAudit callback with nested calls', () => {
    const source = `
      async function handler() {
        await withAudit(user.id, undefined, async (tx) => {
          await tx.select({ id: characters.id }).from(characters).where(eq(characters.id, id)).for('update');
          await tx.update(characters).set({ name: 'x' }).where(eq(characters.id, id));
          await tx.delete(characterTraits).where(eq(characterTraits.characterId, id));
        });
      }
    `;
    expect(findBareWrites(source, 'fixture.ts')).toHaveLength(0);
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
