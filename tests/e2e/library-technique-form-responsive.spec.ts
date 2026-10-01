import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test('technique form helper text wraps without widening the page', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-technique-responsive-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Technique Form QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    data: { name: 'Technique Responsive QA' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const { id: campaignId } = (await campaignResponse.json()) as { id: string };

  await page.goto(`/campaigns/${campaignId}/library?section=techniques`);
  await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '+ Add technique', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Technique name *' });
  await expect(name).toBeVisible();
  await name.fill('A long technique name entered to confirm the form stays usable after resizing.');
  await name.evaluate((input) => input.blur());

  const help = page.getByText(
    'A cap of +1 lets a Karate-1 technique reach full Karate. Leave blank for no cap.',
    { exact: true },
  );
  const penaltyHelp = page.getByText('For example, Karate-1 starts one level below Karate.', {
    exact: true,
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(name).toHaveValue(
      'A long technique name entered to confirm the form stays usable after resizing.',
    );
    await expect(help).toBeVisible();
    await expect(penaltyHelp).toBeVisible();
    const [helpBox, pageWidth, helpWidths] = await Promise.all([
      help.boundingBox(),
      page.evaluate(() => document.documentElement.scrollWidth),
      Promise.all([
        help.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth })),
        penaltyHelp.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
        })),
      ]),
    ]);
    if (!helpBox) throw new Error('Technique helper text has no visible bounding box');
    expect(helpBox.x).toBeGreaterThanOrEqual(0);
    expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(viewport.width);
    for (const width of helpWidths) expect(width.scroll).toBeLessThanOrEqual(width.client);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 320) {
      expect(helpBox.height).toBeGreaterThan(20);
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('technique-form-helper-320x568.png'),
        animations: 'disabled',
        fullPage: true,
      });
    }
    if (viewport.width === 568) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('technique-form-helper-568x320.png'),
        animations: 'disabled',
      });
    }
  }
});
