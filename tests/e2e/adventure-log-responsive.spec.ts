import { type Page, expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function create<T>(page: Page, path: string, body: object): Promise<T> {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method: 'POST',
    data: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

const VIEWPORTS = [
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

test('unbroken adventure-log titles wrap inside their cards', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const author = 'ExtremelyLongUnbrokenAdventureLogAuthorDisplayNameForNarrowScreens';
  const location = 'ExtremelyLongUnbrokenAdventureLogLocationForNarrowScreens';
  const title = 'TheUnreasonablyLongUnbrokenAdventureLogTitleForNarrowScreens';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`adventure-log-responsive-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill(author);
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const campaign = await create<{ id: string }>(page, '/campaigns', {
    name: 'Responsive log titles',
  });
  await create(page, `/campaigns/${campaign.id}/log`, {
    sessionDate: '2026-09-30',
    title,
    location,
    body: 'A representative session entry for narrow display checks.',
  });
  await create(page, `/campaigns/${campaign.id}/log`, {
    sessionDate: '2026-09-29',
    title: 'Session',
    body: 'A short title keeps its ordinary one-line layout.',
  });

  await page.goto(`/campaigns/${campaign.id}/log`);
  const heading = page.getByRole('heading', { name: title, exact: true });
  const card = page.getByRole('article').filter({ has: heading });
  const authorName = card.getByText(author, { exact: true });
  const locationText = page.getByText(location, { exact: true });
  const ordinaryHeading = page.getByRole('heading', { name: 'Session', exact: true });
  await expect(heading).toBeVisible();
  await expect(authorName).toBeVisible();
  await expect(locationText).toBeVisible();
  await expect(ordinaryHeading).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await card.scrollIntoViewIfNeeded();
      const [
        cardBox,
        headingBox,
        titleMetrics,
        authorBox,
        locationBox,
        locationMetrics,
        ordinaryOverflow,
      ] = await Promise.all([
        card.boundingBox(),
        heading.boundingBox(),
        heading.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
        authorName.boundingBox(),
        locationText.boundingBox(),
        locationText.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })),
        ordinaryHeading.evaluate((element) => element.scrollWidth - element.clientWidth),
      ]);
      expect(cardBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      if (!cardBox || !headingBox) return;
      expect(headingBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(titleMetrics.scrollWidth).toBeLessThanOrEqual(titleMetrics.clientWidth + 1);
      expect(locationMetrics.scrollWidth).toBeLessThanOrEqual(locationMetrics.clientWidth + 1);
      expect(ordinaryOverflow).toBeLessThanOrEqual(1);
      expect(authorBox).not.toBeNull();
      expect(locationBox).not.toBeNull();
      if (!authorBox || !locationBox) return;
      expect(authorBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(authorBox.x + authorBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(locationBox.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(locationBox.x + locationBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);

      if ([320, 375, 390, 568, 639, 640, 641, 768, 1024, 1280].includes(viewport.width)) {
        await page.screenshot({
          path: testInfo.outputPath(`log-title-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }
});
