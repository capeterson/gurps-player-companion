import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

test('log award details stay reachable and older entries edit in place', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`log-cards-${suffix}@example.com`);
  await page.getByLabel(/display name/i).fill('Log cards QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const fixtures = await page.evaluate(async () => {
    const { accessToken } = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}');
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
    async function create(path: string, body: unknown) {
      const response = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json();
    }
    const campaign = await create('/campaigns', { name: 'Log card details' });
    const characters = [];
    for (let i = 0; i < 24; i++) {
      characters.push(
        await create('/characters', {
          name: `Chronicler ${i + 1} of the Extremely Distant and Uncharted Northern Realms`,
          campaignId: campaign.id,
        }),
      );
    }
    const awards = characters.map((character, index) => ({
      characterId: character.id,
      amount: index % 2 === 0 ? 3 : 5,
    }));
    await create(`/campaigns/${campaign.id}/log`, {
      sessionDate: '2026-09-01',
      title: 'Older award entry',
      body: 'An older session.',
      xpAwards: awards,
    });
    await create(`/campaigns/${campaign.id}/log`, {
      sessionDate: '2026-09-02',
      title: 'Uniform award entry',
      body: 'Equal awards.',
      xpAwards: characters
        .slice(0, 2)
        .map((character) => ({ characterId: character.id, amount: 3 })),
    });
    for (let i = 0; i < 8; i++) {
      await create(`/campaigns/${campaign.id}/log`, {
        sessionDate: '2026-09-10',
        title: `Newer note ${i}`,
        body: Array(6)
          .fill('The party continued along the coast, recording each discovery.')
          .join('\n\n'),
      });
    }
    return { campaignId: campaign.id };
  });
  await page.goto(`/campaigns/${fixtures.campaignId}/log`);
  const entry = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Older award entry' }) });
  await expect(entry).toContainText('Point awards: 96 points total');
  const uniform = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Uniform award entry' }) });
  await expect(uniform).toContainText('3 points gained');
  for (const width of [320, 639, 640, 641, 767, 768, 769, 857, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const trigger = entry.getByRole('button', {
      name: 'Characters awarded points for Older award entry',
    });
    await expect(trigger).toHaveText('24 characters');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      'Chronicler 1 of the Extremely Distant and Uncharted Northern Realms · 3 points',
    );
    await expect(tooltip).toContainText(
      'Chronicler 24 of the Extremely Distant and Uncharted Northern Realms · 5 points',
    );
    await expect(async () => {
      const box = await tooltip.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      const header = await page.locator('.app-header').boundingBox();
      expect(box.y).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    }).toPass();
    await expect(tooltip.getByText(/Chronicler 1 /)).toBeInViewport();
    await tooltip.hover();
    await page.mouse.wheel(0, 2000);
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByText(/Chronicler 24 /)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`award-tooltip-${width}.png`),
    });
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(0, 0);
  }
  await page.setViewportSize({ width: 857, height: 800 });
  const edit = entry.getByRole('button', { name: 'Edit Older award entry' });
  await edit.scrollIntoViewIfNeeded();
  const cardTop = (await entry.boundingBox())?.y;
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(1000);
  await edit.click();
  // The original article keeps its list position and now contains the real edit fields.
  const form = page
    .getByRole('article')
    .last()
    .getByRole('form', { name: 'Edit adventure log entry' });
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Older award entry');
  expect(Math.abs(((await form.boundingBox())?.y ?? 0) - (cardTop ?? 0))).toBeLessThan(60);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(60);
  await form.getByLabel('Title', { exact: true }).fill('Revised older award entry');
  await captureReviewScreenshot(page, { path: testInfo.outputPath('older-entry-edit.png') });
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('article').last().getByRole('heading', { name: 'Revised older award entry' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit Revised older award entry' }).click();
  await page
    .getByRole('form', { name: 'Edit adventure log entry' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(
    page.getByRole('article').last().getByRole('heading', { name: 'Revised older award entry' }),
  ).toBeVisible();
});
