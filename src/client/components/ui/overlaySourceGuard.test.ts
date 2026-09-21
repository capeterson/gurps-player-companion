/**
 * Source guard for the viewport-overlay invariant in AGENTS.md.
 *
 * Raw daisyUI data-tip tooltips cannot collision-shift, and a viewport-sized
 * dropdown can still be clipped when its trigger is near an edge. Keep new
 * anchored overlays on the shared collision helper. The floating pools panel
 * is the one intentional exception: it is viewport-fixed and centered on
 * narrow screens, with an explicit dynamic-viewport width.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = resolve(process.cwd(), 'src/client');
const VIEWPORT_FIXED_EXCEPTIONS = new Set([
  'features/characters/sections/combat/FloatingPoolsBar.tsx',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

const sources = sourceFiles(CLIENT_ROOT).map((path) => ({
  path: relative(CLIENT_ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

describe('viewport overlay source guard', () => {
  it('does not use raw data-tip tooltips', () => {
    const attribute = `${'data'}-${'tip'}=`;
    expect(
      sources.filter((source) => source.text.includes(attribute)).map((source) => source.path),
    ).toEqual([]);
  });

  it('routes anchored dropdown content through viewport collision handling', () => {
    const dropdownClass = `${'dropdown'}-${'content'}`;
    const offenders = sources
      .filter((source) => source.text.includes(dropdownClass))
      .filter((source) => !source.text.includes('useViewportBoundedOverlay'))
      .filter((source) => !VIEWPORT_FIXED_EXCEPTIONS.has(source.path))
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });
});
