import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });
}

test('character cards wrap long names and keep sheet and campaign links reachable', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(90_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const campaignName = `UnbrokenCampaignLabel${'C'.repeat(96)}`;
  const characterName = `UnbrokenCharacterLabel${'N'.repeat(96)}`;
  let campaignId: string | undefined;
  let characterId: string | undefined;

  try {
    await signIn(page);
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const campaignResponse = await page.request.post('/api/v1/campaigns', {
      data: { name: campaignName },
      headers,
    });
    expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
    campaignId = ((await campaignResponse.json()) as { id: string }).id;

    const characterResponse = await page.request.post('/api/v1/characters', {
      data: { name: characterName, campaignId, st: 11, dx: 12, iq: 13, ht: 14 },
      headers,
    });
    expect(characterResponse.status(), await characterResponse.text()).toBe(201);
    characterId = ((await characterResponse.json()) as { id: string }).id;

    for (const destination of ['/characters', '/']) {
      await page.goto(destination);
      const heading = page.getByRole('heading', { name: characterName, exact: true });
      await expect(heading).toBeVisible({ timeout: 25_000 });
      const card = heading.locator('xpath=ancestor::article[1]');
      const sheetLink = card.locator(`a[href="/characters/${characterId}"]`);
      const campaignLink = card.locator(`a[href="/campaigns/${campaignId}"]`);
      await expect(sheetLink).toContainText(characterName);
      await expect(campaignLink).toHaveText(campaignName);
      await expect(card).toContainText('ST 11');
      await expect(card).toContainText('DX 12');
      await expect(card).toContainText('IQ 13');
      await expect(card).toContainText('HT 14');

      for (const viewport of VIEWPORTS) {
        await test.step(`${destination} at ${viewport.width}×${viewport.height}`, async () => {
          await page.setViewportSize(viewport);
          await expect(heading).toBeVisible();
          await expect(sheetLink).toBeVisible();
          await expect(campaignLink).toBeVisible();
          const cardBox = await card.boundingBox();
          expect(cardBox).not.toBeNull();
          if (cardBox) {
            expect(cardBox.x).toBeGreaterThanOrEqual(0);
            expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width + 1);
          }
          for (const label of [heading, campaignLink]) {
            await label.scrollIntoViewIfNeeded();
            const box = await label.boundingBox();
            expect(box).not.toBeNull();
            if (box) {
              expect(box.x).toBeGreaterThanOrEqual(0);
              expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
              expect(box.y).toBeGreaterThanOrEqual(0);
              expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
            }
            const widths = await label.evaluate((element) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              height: element.getBoundingClientRect().height,
            }));
            expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
            expect(widths.height).toBeGreaterThan(16);
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(viewport.width);
          if (destination === '/' && [320, 568].includes(viewport.width)) {
            await captureReviewScreenshot(page, {
              path: testInfo.outputPath(`recent-cards-${viewport.width}x${viewport.height}.png`),
              animations: 'disabled',
            });
          }
          if (destination === '/characters' && [320, 568].includes(viewport.width)) {
            await captureReviewScreenshot(page, {
              path: testInfo.outputPath(`character-list-${viewport.width}x${viewport.height}.png`),
              animations: 'disabled',
            });
          }
        });
      }
    }
  } finally {
    try {
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
    } finally {
      await pool.end();
    }
  }
});
