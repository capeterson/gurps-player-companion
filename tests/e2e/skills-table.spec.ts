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
  await selectCharacterSection(page, 'Skills');
  await expect(page.getByRole('table', { name: 'Skills' })).toBeVisible();
  return character?.id ?? '';
}

async function addBrowserSkillModifier(page: Page, characterId: string) {
  return page.evaluate(async (id) => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch(`/api/v1/characters/${id}/traits`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        kind: 'advantage',
        name: `Browser skill modifier ${Date.now()}`,
        points: 0,
        modifiers: [],
        customEffects: [{ target: 'skill', skillName: '*', value: 1, scaling: 'flat' }],
      }),
    });
    if (!response.ok) throw new Error(`Trait create returned ${response.status}`);
    return ((await response.json()) as { trait: { id: string } }).trait.id;
  }, characterId);
}

async function removeBrowserSkillModifier(page: Page, characterId: string, traitId: string) {
  await page.evaluate(
    async ({ characterId: id, traitId: ownedTraitId }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      await fetch(`/api/v1/characters/${id}/traits/${ownedTraitId}`, {
        method: 'DELETE',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
    },
    { characterId, traitId },
  );
}

async function expectInsideViewport(page: Page, locator: Locator, includeVertical = false) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  if (includeVertical) {
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

test('skill table and inline editor stay compact across mobile and desktop breakpoints', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'rowan@example.invalid');
  const characterId = await openSeedCharacter(page, 'Kestrel Vale');
  const traitId = await addBrowserSkillModifier(page, characterId);
  await page.reload();
  await selectCharacterSection(page, 'Skills');
  await expect(page.getByRole('button', { name: '+ Add skill' })).toBeVisible();

  try {
    const widths = [390, 639, 640, 641, 767, 768, 769, 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 640 ? 760 : 900 });

      const table = page.getByRole('table', { name: 'Skills' });
      await expectInsideViewport(page, table);
      await expect(page.getByRole('button', { name: 'Sort by Skill' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Points' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Level' })).toBeVisible();
      if (width < 640) {
        await expect(page.getByRole('button', { name: 'Sort by Attr/Dif' })).toBeHidden();
      } else {
        await expect(page.getByRole('button', { name: 'Sort by Attr/Dif' })).toBeVisible();
      }
      const pointsBefore = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelBefore = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();

      const modifier = table.getByRole('button', { name: /^View .* modifiers$/ }).first();
      await expect(modifier).toBeVisible();
      await modifier.hover();
      await expectInsideViewport(page, page.getByRole('tooltip'), true);
      await page.mouse.move(0, 0);

      const edit = table.getByRole('button', { name: /^Edit / }).first();
      await edit.click();
      const editorHeading = page.getByRole('heading', { name: /^Edit / }).first();
      await expect(editorHeading).toBeVisible();
      const pointsAfter = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelAfter = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();
      expect(pointsBefore).not.toBeNull();
      expect(levelBefore).not.toBeNull();
      expect(pointsAfter).not.toBeNull();
      expect(levelAfter).not.toBeNull();
      if (pointsBefore && levelBefore && pointsAfter && levelAfter) {
        expect(pointsAfter.x).toBeCloseTo(pointsBefore.x, 0);
        expect(levelAfter.x).toBeCloseTo(levelBefore.x, 0);
      }
      const editor = editorHeading.locator('xpath=../..');
      await expectInsideViewport(page, editor);
      const name = editor.getByLabel(/ name$/);
      await expect(name).toBeVisible();
      await expect
        .poll(() => name.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThan(width < 768 ? 250 : 90);
      await expect(editor.getByLabel(/ specialization$/)).toBeVisible();
      await expect(editor.getByLabel(/ description and notes$/)).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Delete skill' })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await editor.getByRole('button', { name: 'Done' }).click();
    }
  } finally {
    await removeBrowserSkillModifier(page, characterId, traitId);
  }
});

test('skill controls remain read-only for the GM on mobile and desktop', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 760 } });
  const page = await context.newPage();
  await signIn(page, 'seed@example.invalid');
  await openSeedCharacter(page, 'Kestrel Vale');

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width < 640 ? 760 : 900 });
    const table = page.getByRole('table', { name: 'Skills' });
    await expect(page.getByRole('searchbox', { name: 'Search skills' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort by Skill' })).toBeVisible();
    await expect(table.getByRole('button', { name: /^Reorder / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add skill' })).toHaveCount(0);
    await expect(table.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    const details = table.locator('button[aria-expanded][aria-label^="View "]').first();
    await expect(details).toBeVisible();
    await details.click();
    await expect(page.getByRole('button', { name: 'Delete skill' })).toHaveCount(0);
    await expect(page.getByLabel(/ name$/)).toHaveCount(0);
    await table.locator('button[aria-expanded][aria-label^="Close "]').first().click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await context.close();
});
