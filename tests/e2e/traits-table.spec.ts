import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

const PASSWORD = 'change-me-please-this-is-a-seed-account';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function openSeedCharacter(page: Page, name: string) {
  const characters = await page.evaluate(async () => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch('/api/v1/characters', {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`Character list returned ${response.status}`);
    return (await response.json()) as Array<{ id: string; name: string }>;
  });
  const character = characters.find((candidate) => candidate.name === name);
  expect(character, `${name} is missing from the seeded character list`).toBeDefined();
  await page.goto(`/characters/${character?.id}`);
  await selectCharacterSection(page, 'Traits');
  await expect(page.getByRole('table', { name: 'Traits' })).toBeVisible();
  return character?.id ?? '';
}

async function addBrowserTrait(page: Page, characterId: string, name: string) {
  return page.evaluate(
    async ({ id, traitName }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      const response = await fetch(`/api/v1/characters/${id}/traits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          kind: 'perk',
          name: traitName,
          points: 1,
          notes: 'A compact browser-test trait with searchable notes.',
          modifiers: [],
          customEffects: [],
        }),
      });
      if (!response.ok) throw new Error(`Trait create returned ${response.status}`);
      return ((await response.json()) as { trait: { id: string } }).trait.id;
    },
    { id: characterId, traitName: name },
  );
}

async function removeBrowserTrait(page: Page, characterId: string, traitId: string) {
  await page.evaluate(
    async ({ id, ownedTraitId }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      await fetch(`/api/v1/characters/${id}/traits/${ownedTraitId}`, {
        method: 'DELETE',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
    },
    { id: characterId, ownedTraitId: traitId },
  );
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

test('trait table and inline editor mirror skills across mobile and desktop breakpoints', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'rowan@example.invalid');
  const characterId = await openSeedCharacter(page, 'Kestrel Vale');
  const traitName = `Browser layout trait ${Date.now()}`;
  const traitId = await addBrowserTrait(page, characterId, traitName);
  await page.reload();
  await selectCharacterSection(page, 'Traits');

  try {
    for (const width of [320, 390, 639, 640, 641, 767, 768, 769, 1280]) {
      await page.setViewportSize({ width, height: width < 640 ? 760 : 900 });
      const table = page.getByRole('table', { name: 'Traits' });
      await expectInsideViewport(page, table);
      await expect(page.getByRole('button', { name: '+ Add trait' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Points' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Level' })).toBeVisible();
      if (width < 640) {
        await expect(page.getByRole('button', { name: 'Sort by Type' })).toBeHidden();
      } else {
        await expect(page.getByRole('button', { name: 'Sort by Type' })).toBeVisible();
      }

      const row = table.getByRole('rowgroup', { name: traitName });
      const traitHandleBox = await row.getByRole('button', { name: /^Reorder / }).boundingBox();
      const pointsBefore = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelBefore = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();
      await row.getByRole('button', { name: `Edit ${traitName}` }).click();
      const editorHeading = page.getByRole('heading', { name: `Edit ${traitName}` });
      await expect(editorHeading).toBeVisible();
      const editor = editorHeading.locator('xpath=../..');
      await expectInsideViewport(page, editor);
      await expect(editor.getByLabel(`${traitName} name`)).toBeVisible();
      await expect(editor.getByLabel(`${traitName} points`)).toBeVisible();
      await expect(editor.getByLabel(`${traitName} description and notes`)).toBeVisible();
      await expect(editor.getByText('Source & rules')).toHaveCount(0);
      await expect(editor.getByRole('button', { name: '+ Add custom effects' })).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Delete trait' })).toBeVisible();
      const pointsAfter = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelAfter = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();
      expect(pointsAfter?.x).toBeCloseTo(pointsBefore?.x ?? 0, 0);
      expect(levelAfter?.x).toBeCloseTo(levelBefore?.x ?? 0, 0);
      await editor.getByRole('button', { name: 'Done' }).click();

      await selectCharacterSection(page, 'Skills');
      const skillHandleBox = await page
        .getByRole('table', { name: 'Skills' })
        .getByRole('button', { name: /^Reorder / })
        .first()
        .boundingBox();
      expect(traitHandleBox?.x).toBeCloseTo(skillHandleBox?.x ?? 0, 0);
      expect(traitHandleBox?.width).toBeCloseTo(skillHandleBox?.width ?? 0, 0);
      await selectCharacterSection(page, 'Traits');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
  } finally {
    await removeBrowserTrait(page, characterId, traitId);
  }
});

test('trait browsing stays available without mutation controls for a read-only campaign viewer', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, 'rowan@example.invalid');
  const characterId = await openSeedCharacter(ownerPage, 'Kestrel Vale');
  const traitName = `Reader-visible trait ${Date.now()}`;
  const traitId = await addBrowserTrait(ownerPage, characterId, traitName);

  try {
    const readerContext = await browser.newContext({ viewport: { width: 390, height: 760 } });
    const readerPage = await readerContext.newPage();
    await signIn(readerPage, 'seed@example.invalid');
    await openSeedCharacter(readerPage, 'Kestrel Vale');

    for (const width of [390, 1280]) {
      await readerPage.setViewportSize({ width, height: width < 640 ? 760 : 900 });
      await readerPage.getByRole('searchbox', { name: 'Search traits' }).fill(traitName);
      const row = readerPage
        .getByRole('table', { name: 'Traits' })
        .getByRole('rowgroup', { name: traitName });
      await expect(row).toBeVisible();
      await expect(readerPage.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
      await expect(row.getByRole('button', { name: /^Reorder / })).toBeVisible();
      await expect(readerPage.getByRole('button', { name: '+ Add trait' })).toHaveCount(0);
      await expect(row.getByRole('button', { name: `Edit ${traitName}` })).toHaveCount(0);
      await row.getByRole('button', { name: `View ${traitName}` }).click();
      await expect(
        row.getByText('A compact browser-test trait with searchable notes.', { exact: true }),
      ).toBeVisible();
      await expect(readerPage.getByRole('button', { name: 'Delete trait' })).toHaveCount(0);
      await row.getByRole('button', { name: `Close ${traitName}` }).click();
      await expect
        .poll(() => readerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
    await readerContext.close();
  } finally {
    await removeBrowserTrait(ownerPage, characterId, traitId);
    await ownerContext.close();
  }
});
