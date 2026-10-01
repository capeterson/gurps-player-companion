import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  { width: 1440, height: 900 },
];

test('GM dashboard wraps long character names in cards and the live activity feed', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated campaign fixtures can be removed',
  );
  test.setTimeout(90_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const email = `gm-dashboard-responsive-${suffix()}@example.com`;
  const actorName = 'G'.repeat(80);
  let campaignId: string | undefined;
  let characterId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(actorName);
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const campaignResponse = await page.request.post('/api/v1/campaigns', {
      data: { name: 'Northern Company Responsive Session' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
    campaignId = ((await campaignResponse.json()) as { id: string }).id;

    const characterName = 'X'.repeat(120);
    const characterResponse = await page.request.post('/api/v1/characters', {
      data: { name: characterName, campaignId, st: 11, dx: 12, iq: 13, ht: 14 },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(characterResponse.status(), await characterResponse.text()).toBe(201);
    characterId = ((await characterResponse.json()) as { id: string }).id;

    await page.goto(`/campaigns/${campaignId}/gm`);
    const characterCard = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: characterName, exact: true }) });
    await expect(characterCard).toBeVisible({ timeout: 25_000 });
    const feed = page
      .locator('aside')
      .filter({ has: page.getByRole('heading', { name: 'Character changes', exact: true }) });
    const summaryText = `Created character ${characterName}`;
    const summary = feed.getByText(summaryText, { exact: true });
    const actorText = `by ${actorName}`;
    const actor = feed.getByText(actorText, { exact: true });
    await expect(summary).toBeVisible({ timeout: 25_000 });
    await expect(actor).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await summary.scrollIntoViewIfNeeded();
        await expect(characterCard).toBeVisible();
        await expect(
          characterCard.getByRole('heading', { name: characterName, exact: true }),
        ).toBeVisible();
        await expect(summary).toHaveText(summaryText);
        await expect(actor).toHaveText(actorText);

        const geometry = await Promise.all(
          [summary, actor].map((text) =>
            text.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const feed = element.closest('aside')?.getBoundingClientRect();
              return {
                x: box.x,
                right: box.right,
                height: box.height,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                feed: feed ? { x: feed.x, right: feed.right } : null,
                documentWidth: document.documentElement.scrollWidth,
              };
            }),
          ),
        );
        const [summaryGeometry, actorGeometry] = geometry;
        const feedGeometry = summaryGeometry?.feed;
        expect(feedGeometry).not.toBeNull();
        for (const textGeometry of [summaryGeometry, actorGeometry]) {
          expect(textGeometry).toBeDefined();
          if (!textGeometry) continue;
          expect(textGeometry.x).toBeGreaterThanOrEqual(0);
          expect(textGeometry.right).toBeLessThanOrEqual(viewport.width);
          expect(textGeometry.scrollWidth).toBeLessThanOrEqual(textGeometry.clientWidth);
          expect(textGeometry.documentWidth).toBeLessThanOrEqual(viewport.width);
        }
        expect(summaryGeometry?.height).toBeGreaterThan(38);
        if (feedGeometry) {
          expect(feedGeometry.x).toBeGreaterThanOrEqual(0);
          expect(feedGeometry.right).toBeLessThanOrEqual(viewport.width);
        }

        if ([320, 568, 640, 1024, 1440].some((width) => width === viewport.width)) {
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(`gm-dashboard-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }
  } finally {
    try {
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
