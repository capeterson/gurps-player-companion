import { type Locator, type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

// The Sunbolt sun glow is anchored on the brand mark (--sun-x/--sun-y in
// theme.css), so the single-row desktop header must keep the mark's centre fixed.
const MARK_CENTRE = { x: 42, y: 30 };
const ROW_HEIGHT = 60;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value, 'element has a measurable box').not.toBeNull();
  return value as NonNullable<typeof value>;
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('desktop character header keeps HP and FP on one row without moving the brand mark', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const characterId = await page.evaluate(async () => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch('/api/v1/characters', {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    const characters = (await response.json()) as Array<{ id: string; name: string }>;
    return characters.find((character) => character.name === 'Kestrel Vale')?.id;
  });
  expect(characterId).toBeTruthy();

  const header = page.locator('header').first();
  const mark = header.locator('.brand-mark:visible').first();
  const hp = header.getByRole('button', { name: /^Adjust HP,/ });
  const fp = header.getByRole('button', { name: /^Adjust FP,/ });
  const account = header.locator('summary[aria-label="Open user menu"]');
  const posture = header.getByRole('button', { name: /^Change posture,/ });
  const maneuver = header.getByRole('button', { name: /^Change maneuver,/ });
  const conditions = header.getByRole('button', { name: /^Change conditions,/ });

  async function checkRow(width: number, stripVisible: boolean) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const label = `${width}px`;
    const markBox = await box(mark);
    expect(markBox.x + markBox.width / 2, `${label} mark x`).toBeCloseTo(MARK_CENTRE.x, 0);
    expect(markBox.y + markBox.height / 2, `${label} mark y`).toBeCloseTo(MARK_CENTRE.y, 0);

    const [hpBox, fpBox, accountBox, headerBox] = await Promise.all([
      box(hp),
      box(fp),
      box(account),
      box(header),
    ]);
    for (const control of [hpBox, fpBox]) {
      expect(control.height, `${label} pool height`).toBeCloseTo(36, 0);
      expect(control.y + control.height, `${label} pool is on the first row`).toBeLessThanOrEqual(
        ROW_HEIGHT,
      );
    }
    expect(hpBox.x + hpBox.width, `${label} HP before FP`).toBeLessThanOrEqual(fpBox.x);
    expect(fpBox.x + fpBox.width, `${label} FP before account`).toBeLessThanOrEqual(accountBox.x);
    expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(width);
    await expect(header.getByText('Current Status', { exact: true })).toHaveCount(0);

    if (!stripVisible) {
      expect(headerBox.height, `${label} one-row header`).toBeLessThanOrEqual(ROW_HEIGHT + 2);
      await expect(posture).toHaveCount(0);
      return;
    }
    for (const trigger of [posture, maneuver, conditions]) {
      await expect(trigger).toBeVisible();
      const triggerBox = await box(trigger);
      expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(width);
      if (width >= 1792) {
        expect(triggerBox.y + triggerBox.height, `${label} inline`).toBeLessThanOrEqual(ROW_HEIGHT);
      } else {
        expect(triggerBox.y, `${label} strip below the row`).toBeGreaterThanOrEqual(ROW_HEIGHT - 1);
      }
    }
    if (width >= 1792) {
      expect(headerBox.height).toBeLessThanOrEqual(ROW_HEIGHT + 2);
      const [postureBox, conditionsBox] = await Promise.all([box(posture), box(conditions)]);
      expect(
        conditionsBox.x + conditionsBox.width,
        `${label} inline before HP`,
      ).toBeLessThanOrEqual(hpBox.x);
      expect(postureBox.x).toBeGreaterThan(MARK_CENTRE.x);
    }
  }

  await page.goto('/settings');
  const statusHeader = page.getByRole('checkbox', { name: 'Show status header' });
  await expect(statusHeader).not.toBeChecked();
  await page.goto(`/characters/${characterId}`);
  await expect(hp).toBeVisible();
  const widths = [1280, 1281, 1440, 1791, 1792, 1920];
  for (const width of widths) await checkRow(width, false);
  await captureReviewScreenshot(page, { path: 'test-results/desktop-header-off-1920.png' });

  await page.goto('/settings');
  await statusHeader.check();
  await page.goto(`/characters/${characterId}`);
  await expect(posture).toBeVisible();
  for (const width of widths) {
    await checkRow(width, true);
    await captureReviewScreenshot(page, { path: `test-results/desktop-header-on-${width}.png` });
  }

  // The HP popover opens under the single row and stays inside the viewport.
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await hp.click();
    const panel = header.getByRole('group', { name: 'HP adjustment' });
    await expect(panel).toBeVisible();
    const [panelBox, headerBox, hpBox] = await Promise.all([box(panel), box(header), box(hp)]);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900);
    expect(panelBox.y).toBeGreaterThanOrEqual(hpBox.y + hpBox.height);
    expect(panelBox.y).toBeLessThanOrEqual(headerBox.y + headerBox.height + 2);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  }

  // Below 1280px the compact bar is unchanged and its sun anchor is 30/26.
  await page.setViewportSize({ width: 1279, height: 700 });
  await settle(page);
  const compactMark = await box(mark);
  expect(compactMark.x + compactMark.width / 2).toBeCloseTo(30, 0);
  expect(compactMark.y + compactMark.height / 2).toBeCloseTo(26, 0);

  await page.goto('/settings');
  await statusHeader.uncheck();
});
