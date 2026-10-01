import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const PASSWORD = 'CorrectHorseBatteryStaple1';
const ACTOR_NAME = 'UnbrokenActorName'.repeat(4);
const SOURCE_NAME = 'A'.repeat(160);
const TRAIT_NAME = 'UnbrokenCharacterTraitName'.repeat(5);

async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  viewport: { width: number; height: number },
) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
}

async function expectWrappedText(locator: import('@playwright/test').Locator) {
  const metrics = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    height: element.getBoundingClientRect().height,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.height).toBeGreaterThan(16);
}

async function expectUsefulSummaryWidth(
  locator: import('@playwright/test').Locator,
  viewportWidth: number,
) {
  const clientWidth = await locator.evaluate((element) => element.clientWidth);
  if (viewportWidth === 320) expect(clientWidth).toBeGreaterThanOrEqual(130);
}

test('character and campaign history wrap long summaries and keep expanded details reachable', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `history-responsive-${runId}@example.com`;
  const campaignName = `History responsive ${runId}`;
  const characterName = `History responsive character ${runId}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(ACTOR_NAME);
    await page.getByLabel(/^password\b/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const campaignResponse = await page.request.post('/api/v1/campaigns', {
      data: { name: campaignName },
      headers,
    });
    expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
    const campaign = (await campaignResponse.json()) as { id: string };

    const yaml = JSON.stringify({
      version: 14,
      library: {
        sources: [
          {
            name: SOURCE_NAME,
            key: 'qa-history-long-source',
            abbreviation: 'HISTORY',
            priority: 10,
          },
        ],
        traits: [],
        skills: [],
        items: [],
      },
    });
    const importResponse = await page.request.post(
      `/api/v1/campaigns/${campaign.id}/library/import`,
      { data: { yaml, mode: 'merge' }, headers },
    );
    expect(importResponse.ok(), await importResponse.text()).toBeTruthy();

    const characterResponse = await page.request.post('/api/v1/characters', {
      data: { name: characterName, campaignId: campaign.id },
      headers,
    });
    expect(characterResponse.ok(), await characterResponse.text()).toBeTruthy();
    const character = (await characterResponse.json()) as { id: string };
    await page.goto(`/characters/${character.id}`);
    await expectCharacterNavigationReady(page);
    await selectCharacterSection(page, 'Traits');
    await page.getByRole('button', { name: '+ Add trait' }).click();
    await page.getByLabel('Trait name').fill(TRAIT_NAME);
    await page.getByRole('button', { name: /^add$/i }).click();
    await expect(
      page.getByRole('button', { name: `Edit ${TRAIT_NAME}`, exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/v1/characters/${character.id}`, { headers });
        if (!response.ok()) return false;
        const detail = (await response.json()) as { traits?: Array<{ name: string }> };
        return detail.traits?.some((trait) => trait.name === TRAIT_NAME) ?? false;
      })
      .toBe(true);

    await selectCharacterSection(page, 'History');
    const characterSummary = page.getByText(new RegExp(`^Added .*${TRAIT_NAME}$`));
    await expect(characterSummary).toBeVisible({ timeout: 30_000 });
    const characterRow = characterSummary.locator('xpath=../..');
    const characterSummaryContent = characterSummary.locator('xpath=..');
    const characterActor = characterRow.getByText(ACTOR_NAME, { exact: true });
    await expect(characterActor).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`character history ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(characterSummary).toBeVisible();
        await expect(characterActor).toBeVisible();
        if (viewport.width === 320 || viewport.width === 568) {
          await characterSummary.scrollIntoViewIfNeeded();
          const screenshot = await page.screenshot({ animations: 'disabled' });
          const path = testInfo.outputPath(
            `character-history-${viewport.width}x${viewport.height}.png`,
          );
          await writeFile(path, screenshot);
          await testInfo.attach(`character-history-${viewport.width}x${viewport.height}`, {
            path,
            contentType: 'image/png',
          });
        }
        await expectWrappedText(characterSummaryContent);
        await expectUsefulSummaryWidth(characterSummaryContent, viewport.width);
        await expectWrappedText(characterActor);
        await expectNoHorizontalOverflow(page, viewport);
        await characterActor.scrollIntoViewIfNeeded();
        const actorBox = await characterActor.boundingBox();
        expect(actorBox).not.toBeNull();
        expect(actorBox?.x).toBeGreaterThanOrEqual(0);
        expect((actorBox?.x ?? 0) + (actorBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
        expect(actorBox?.y).toBeGreaterThanOrEqual(0);
        expect((actorBox?.y ?? 0) + (actorBox?.height ?? 0)).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        if (viewport.width === 320 || viewport.width === 568) {
          const screenshot = await page.screenshot({ animations: 'disabled' });
          const path = testInfo.outputPath(
            `character-history-actor-${viewport.width}x${viewport.height}.png`,
          );
          await writeFile(path, screenshot);
          await testInfo.attach(`character-history-actor-${viewport.width}x${viewport.height}`, {
            path,
            contentType: 'image/png',
          });
        }
      });
    }

    await page.goto(`/campaigns/${campaign.id}/history`);
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Campaign changes' })).toBeVisible();
    const campaignSummary = page.getByText(`Added library source ${SOURCE_NAME}`, { exact: true });
    await expect(campaignSummary).toBeVisible({ timeout: 30_000 });
    const campaignSummaryRow = campaignSummary.locator('xpath=ancestor::summary[1]');
    const campaignEvent = campaignSummaryRow.locator('xpath=..');
    const campaignSummaryContent = campaignSummary.locator('xpath=..');
    const campaignActor = campaignSummaryRow.getByText(ACTOR_NAME, { exact: true });

    for (const viewport of VIEWPORTS) {
      await test.step(`campaign history ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(campaignSummary).toBeVisible();
        await expect(campaignActor).toBeVisible();
        if (viewport.width === 320 || viewport.width === 568) {
          await campaignSummary.scrollIntoViewIfNeeded();
          const screenshot = await page.screenshot({ animations: 'disabled' });
          const path = testInfo.outputPath(
            `campaign-history-${viewport.width}x${viewport.height}.png`,
          );
          await writeFile(path, screenshot);
          await testInfo.attach(`campaign-history-${viewport.width}x${viewport.height}`, {
            path,
            contentType: 'image/png',
          });
        }
        await expectWrappedText(campaignSummaryContent);
        await expectUsefulSummaryWidth(campaignSummaryContent, viewport.width);
        await expectWrappedText(campaignActor);
        await expectNoHorizontalOverflow(page, viewport);
        await campaignActor.scrollIntoViewIfNeeded();
        const campaignActorBox = await campaignActor.boundingBox();
        expect(campaignActorBox).not.toBeNull();
        expect(campaignActorBox?.y).toBeGreaterThanOrEqual(0);
        expect((campaignActorBox?.y ?? 0) + (campaignActorBox?.height ?? 0)).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        if (viewport.width === 320 || viewport.width === 568) {
          const screenshot = await page.screenshot({ animations: 'disabled' });
          const path = testInfo.outputPath(
            `campaign-history-actor-${viewport.width}x${viewport.height}.png`,
          );
          await writeFile(path, screenshot);
          await testInfo.attach(`campaign-history-actor-${viewport.width}x${viewport.height}`, {
            path,
            contentType: 'image/png',
          });
        }
        const rowBox = await campaignSummaryRow.boundingBox();
        expect(rowBox).not.toBeNull();
        expect(rowBox?.x).toBeGreaterThanOrEqual(0);
        expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
      });
    }

    await campaignSummaryRow.click();
    const rawToggle = campaignEvent.getByText('Raw', { selector: 'summary', exact: true });
    await expect(rawToggle).toBeVisible();
    await rawToggle.click();
    const rawDetails = campaignEvent.locator('pre').last();
    await expect(rawDetails).toContainText(SOURCE_NAME);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(rawDetails).toBeVisible();
      await expectNoHorizontalOverflow(page, viewport);
      const rawBox = await rawDetails.boundingBox();
      expect(rawBox).not.toBeNull();
      expect(rawBox?.x).toBeGreaterThanOrEqual(0);
      expect((rawBox?.x ?? 0) + (rawBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    }
  } finally {
    try {
      await pool.query(
        'delete from characters where owner_id=(select id from users where email=$1)',
        [email],
      );
      await pool.query(
        'delete from campaigns where owner_id=(select id from users where email=$2) and name=$1',
        [campaignName, email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
