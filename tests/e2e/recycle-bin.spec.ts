import { type Page, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

// Just below, at and above the sm (640px) breakpoint, plus the narrowest phone and desktop.
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 1280, height: 800 },
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });
}

async function inside(page: Page, locator: ReturnType<Page['locator']>, label: string) {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  expect(box, `${label} has a box`).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y, `${label} top`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${label} bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

test('delete a character from its card, find it in the recycle bin and restore it', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const suffix = Date.now().toString(36);
  const longName = `UnbrokenBinnedHero${'N'.repeat(90)}${suffix}`;
  const campaignName = `Binned campaign ${suffix}`;
  const ids: { characters: string[]; campaigns: string[] } = { characters: [], campaigns: [] };

  try {
    await signIn(page);
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const character = await page.request.post('/api/v1/characters', {
      data: { name: longName, st: 11, dx: 12, iq: 13, ht: 14 },
      headers,
    });
    expect(character.status(), await character.text()).toBe(201);
    const characterId = ((await character.json()) as { id: string }).id;
    ids.characters.push(characterId);

    await page.goto('/characters');
    const heading = page.getByRole('heading', { name: longName, exact: true });
    await expect(heading).toBeVisible({ timeout: 25_000 });
    const card = heading.locator('xpath=ancestor::article[1]');
    const menuButton = card.getByLabel(`Actions for ${longName}`);

    // The actions menu stays reachable and clear of the name at every width.
    for (const viewport of VIEWPORTS) {
      await test.step(`menu at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await menuButton.scrollIntoViewIfNeeded();
        await menuButton.click();
        const item = page.getByRole('button', { name: 'Delete…' });
        await expect(item).toBeVisible();
        await inside(page, menuButton, 'menu button');
        await inside(page, item, 'Delete item');
        const buttonBox = await menuButton.boundingBox();
        const linkBox = await card.locator(`a[href="/characters/${characterId}"]`).boundingBox();
        if (buttonBox && linkBox) {
          const overlapX =
            Math.min(buttonBox.x + buttonBox.width, linkBox.x + linkBox.width) -
            Math.max(buttonBox.x, linkBox.x);
          expect(overlapX, 'menu button does not overlap the name').toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if ([320, 1280].includes(viewport.width))
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(`card-menu-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        await page.keyboard.press('Escape');
        await expect(item).toBeHidden();
      });
    }

    // Delete: confirm, character leaves the list, toast offers Undo.
    await page.setViewportSize({ width: 375, height: 667 });
    await menuButton.click();
    await page.getByRole('button', { name: 'Delete…' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete character?' });
    await expect(confirm).toContainText('permanently deleted after 30 days');
    await inside(page, confirm.locator('.modal-box'), 'confirm dialog');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`Deleted ${longName}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(heading).toBeHidden();

    // The recycle bin lists it with Restore / Delete now inside the viewport.
    await page.getByRole('link', { name: 'Recycle bin' }).click();
    await expect(page.getByRole('heading', { name: 'Recycle bin' })).toBeVisible();
    await expect
      .poll(async () => page.getByText(longName).count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    const row = page
      .getByText(longName)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"rounded-box")][1]');
    for (const viewport of VIEWPORTS) {
      await test.step(`bin row at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await inside(page, row.getByRole('button', { name: 'Restore' }), 'Restore');
        await inside(page, row.getByRole('button', { name: 'Delete now' }), 'Delete now');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if ([320, 1280].includes(viewport.width))
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(`recycle-bin-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
      });
    }
    await page.setViewportSize({ width: 375, height: 667 });

    // Restore brings the sheet back, intact.
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(`Restored ${longName}`)).toBeVisible();
    await page.goto('/characters');
    await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator('article', { hasText: longName })).toContainText('ST 11');

    // A deleted campaign appears in the bin and its permanent delete needs the name retyped.
    const campaign = await page.request.post('/api/v1/campaigns', {
      data: { name: campaignName },
      headers,
    });
    expect(campaign.status(), await campaign.text()).toBe(201);
    const campaignId = ((await campaign.json()) as { id: string }).id;
    ids.campaigns.push(campaignId);
    expect(
      (await page.request.delete(`/api/v1/campaigns/${campaignId}`, { headers })).status(),
    ).toBe(204);
    await page.goto('/recycle-bin');
    const campaignRow = page
      .getByText(campaignName)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"rounded-box")][1]');
    await expect(campaignRow).toBeVisible({ timeout: 20_000 });
    await campaignRow.getByRole('button', { name: 'Delete now' }).click();
    const retype = page.getByRole('dialog', { name: 'Permanently delete campaign?' });
    const confirmDelete = retype.getByRole('button', { name: 'Delete now' });
    await expect(confirmDelete).toBeDisabled();
    await retype.getByRole('textbox', { name: 'Type campaign name to confirm' }).fill(campaignName);
    await expect(confirmDelete).toBeEnabled();
    await confirmDelete.click();
    await expect(page.getByText(`Permanently deleted ${campaignName}`)).toBeVisible();
    await expect(page.getByText(campaignName)).toBeHidden();
  } finally {
    try {
      if (ids.characters.length)
        await pool.query('delete from characters where id = any($1)', [ids.characters]);
      if (ids.campaigns.length)
        await pool.query('delete from campaigns where id = any($1)', [ids.campaigns]);
    } finally {
      await pool.end();
    }
  }
});
