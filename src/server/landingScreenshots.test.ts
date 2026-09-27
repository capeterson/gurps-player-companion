import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

it('keeps landing screenshots and README on the same canonical public assets', () => {
  const root = new URL('../../', import.meta.url);
  const landing = readFileSync(new URL('src/client/features/home/LandingPage.tsx', root), 'utf8');
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const landingPaths = [...landing.matchAll(/src=["'](\/screenshots\/[^"']+)["']/g)].map(
    (match) => match[1] ?? '',
  );
  const readmePaths = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1] ?? '')
    .filter((path) => path.includes('screenshots/'));
  expect(landingPaths.length).toBeGreaterThanOrEqual(2);
  expect(readmePaths.length).toBeGreaterThanOrEqual(2);
  for (const path of landingPaths) {
    const canonical = `public${path}`;
    expect(existsSync(fileURLToPath(new URL(canonical, root))), canonical).toBe(true);
    expect(readmePaths, canonical).toContain(canonical);
  }
  for (const path of readmePaths) {
    expect(path, 'README screenshots must use canonical public assets').toStartWith(
      'public/screenshots/',
    );
    expect(existsSync(fileURLToPath(new URL(path, root))), path).toBe(true);
  }
});
