import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

async function expectHorizontalBounds(locator: Locator, width: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
}

test('inline sheet editors use their summary rows for context at responsive widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await signIn(page);
  const headers = { Authorization: `Bearer ${token}` };
  async function create(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, { data, headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const character = await create('/characters', { name: 'Inline Editor Surveyor' });
  const longName =
    'PneumonoultramicroscopicsilicovolcanoconiosisResponsiveSurveyorWithAnUnusuallyLongName';
  const skillName = `${longName}Skill`;
  const entries = [
    {
      section: 'Traits',
      collection: 'traits',
      name: `${longName}Trait`,
      data: { kind: 'advantage', points: 5 },
    },
    {
      section: 'Skills',
      collection: 'skills',
      name: skillName,
      data: { attribute: 'DX', difficulty: 'A', points: 1 },
    },
    {
      section: 'Magic',
      collection: 'spells',
      name: `${longName}Spell`,
      data: { college: 'Air', points: 1 },
    },
    {
      section: 'Skills',
      collection: 'languages',
      name: `${longName}Language`,
      data: { spokenFluency: 'accented', writtenFluency: 'none', points: 2 },
    },
    {
      section: 'Skills',
      collection: 'techniques',
      name: `${longName}Technique`,
      data: { defaultSkillName: skillName, defaultModifier: -2, points: 1 },
    },
  ];
  try {
    for (const entry of entries)
      await create(`/characters/${character.id}/${entry.collection}`, {
        name: entry.name,
        ...entry.data,
      });
    await page.goto(`/characters/${character.id}`);
    for (const entry of entries) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await selectCharacterSection(page, entry.section);
      const edit = page.getByRole('button', { name: `Edit ${entry.name}`, exact: true });
      await edit.click();
      const summary = page.getByRole('row').filter({ hasText: entry.name }).first();
      const nameInput = page.getByRole('textbox', { name: `${entry.name} name`, exact: true });
      const editor = nameInput.locator('xpath=ancestor::tr');
      await expect(nameInput).toBeVisible();
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 568, height: 320 },
        { width: 639, height: 800 },
        { width: 640, height: 800 },
        { width: 641, height: 800 },
        { width: 767, height: 800 },
        { width: 768, height: 800 },
        { width: 769, height: 800 },
        { width: 1023, height: 800 },
        { width: 1024, height: 800 },
        { width: 1025, height: 800 },
        { width: 1280, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(summary).toContainText(entry.name);
        await expect(page.getByText(`Edit ${entry.name}`, { exact: true })).toHaveCount(0);
        await nameInput.scrollIntoViewIfNeeded();
        await nameInput.focus();
        await expect(nameInput).toHaveValue(entry.name);
        await expectHorizontalBounds(summary, viewport.width);
        await expectHorizontalBounds(editor, viewport.width);
        await expectHorizontalBounds(nameInput, viewport.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if (viewport.width === 320 || viewport.height === 320 || viewport.width === 1280) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `${entry.collection}-editor-${viewport.width}x${viewport.height}`,
            {
              animations: 'disabled',
              path: testInfo.outputPath(
                `${entry.collection}-editor-${viewport.width}x${viewport.height}.png`,
              ),
            },
          );
        }
      }
      await page
        .getByRole('button', {
          name: `${entry.collection === 'spells' ? 'Done editing' : 'Close'} ${entry.name}`,
          exact: true,
        })
        .click();
      await expect(nameInput).not.toBeVisible();
    }
  } finally {
    await page.request.delete(`/api/v1/characters/${character.id}`, { headers });
  }
});
