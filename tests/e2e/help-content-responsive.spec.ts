import { expect, test } from '@playwright/test';
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

test('library help and About prose, links, code, and navigation fit responsive viewports', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await signIn(page);

  await page.goto('/help/campaign-library');
  const guideTitle = page.getByRole('heading', { name: 'Building your campaign library' });
  const guideNav = page.getByRole('navigation', { name: 'In this guide' });
  await expect(guideTitle).toBeVisible();
  await expect(guideNav).toBeVisible();
  const pricingLink = guideNav.getByRole('link', { name: 'Advanced: pricing and modifiers' });
  const pricingSection = page.locator('section[aria-labelledby="advanced-pricing-and-modifiers"]');
  const pricingHeading = pricingSection.getByRole('heading', {
    name: 'Advanced: pricing and modifiers',
  });
  const codeBlock = pricingSection.locator('pre').first();
  await expect(pricingHeading).toBeVisible();
  await expect(codeBlock).toContainText('version: 1');
  await expect(codeBlock).toContainText('rounding: exact');

  for (const viewport of VIEWPORTS) {
    await test.step(`library guide at ${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(guideNav).toBeVisible();
      await expect(pricingLink).toBeVisible();
      const linkBox = await pricingLink.boundingBox();
      expect(linkBox).not.toBeNull();
      if (linkBox) {
        expect(linkBox.x).toBeGreaterThanOrEqual(0);
        expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await guideNav.getByRole('link', { name: 'Troubleshoot an entry' }).click();
      await expect(page).toHaveURL(/#troubleshoot-an-entry$/);
      await page.evaluate(() => window.scrollTo(0, 0));
      await pricingLink.click();
      await expect(page).toHaveURL(/#advanced-pricing-and-modifiers$/);
      await codeBlock.scrollIntoViewIfNeeded();

      const [documentWidth, codeMetrics, codeBox] = await Promise.all([
        page.evaluate(() => document.documentElement.scrollWidth),
        codeBlock.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflowX: style.overflowX,
          };
        }),
        codeBlock.boundingBox(),
      ]);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(codeBox).not.toBeNull();
      if (codeBox) {
        expect(codeBox.x).toBeGreaterThanOrEqual(0);
        expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      if (codeMetrics.scrollWidth > codeMetrics.clientWidth) {
        expect(['auto', 'scroll']).toContain(codeMetrics.overflowX);
        await codeBlock.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        const scrollLeft = await codeBlock.evaluate((element) => element.scrollLeft);
        expect(scrollLeft).toBeGreaterThan(0);
      }

      if ([320, 568].includes(viewport.width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`library-help-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }

  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'GURPS Player Companion' })).toBeVisible();
  const legal = page.getByRole('heading', { name: 'Legal' }).locator('xpath=..');
  const source = page.getByRole('heading', { name: 'Source' }).locator('xpath=..');
  const policyLink = legal.getByRole('link', { name: 'Steve Jackson Games Online Policy' });
  const sourceLink = source.getByRole('link', {
    name: 'https://github.com/capeterson/gurps-player-companion/',
  });
  await expect(policyLink).toBeVisible();
  await expect(sourceLink).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await test.step(`About at ${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await expect(page.getByRole('heading', { name: 'GURPS Player Companion' })).toBeVisible();
      for (const link of [policyLink, sourceLink]) {
        const linkBox = await link.boundingBox();
        expect(linkBox).not.toBeNull();
        if (linkBox) {
          expect(linkBox.x).toBeGreaterThanOrEqual(0);
          expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(viewport.width + 1);
        }
      }
      const [documentWidth, textWidths] = await Promise.all([
        page.evaluate(() => document.documentElement.scrollWidth),
        Promise.all(
          [legal.locator('p'), source.locator('p')].map((paragraph) =>
            paragraph.evaluate((element) => ({
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          ),
        ),
      ]);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width);
      for (const [label, width] of [
        ['Legal prose', textWidths[0]],
        ['Source prose', textWidths[1]],
      ] as const) {
        expect(width.scrollWidth, `${label} at ${viewport.width}px`).toBeLessThanOrEqual(
          width.clientWidth + 1,
        );
      }
      if ([320, 568].includes(viewport.width)) {
        await source.scrollIntoViewIfNeeded();
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`about-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
    });
  }
});
