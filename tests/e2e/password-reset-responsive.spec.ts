import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const invalidResetMessage = 'This reset link is invalid or has expired. Please request a new one.';

test('expired reset links offer a reachable request-new-link action on mobile and landscape', async ({
  page,
}, testInfo) => {
  const viewports = [
    { width: 568, height: 320 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
  ];

  await page.route('**/api/v1/auth/reset-password', async (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'expired' }),
    }),
  );

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const mode of ['dark', 'light'] as const) {
      await page.goto('/');
      await page.evaluate((themeMode) => localStorage.setItem('gpc.theme', themeMode), mode);
      await page.goto('/reset-password?token=expired');
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        mode === 'dark' ? 'gilded-tome' : 'illuminated-manuscript',
      );
      await expect(
        page.getByRole('heading', { name: 'Reset password', exact: true }),
      ).toBeVisible();
      await page.getByLabel('New password').fill('CorrectHorseBatteryStaple2');
      await page.getByLabel('Confirm password').fill('CorrectHorseBatteryStaple2');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();

      await expect(page.getByText(invalidResetMessage, { exact: true })).toBeVisible();
      const requestLink = page.getByRole('link', { name: 'Request a new link', exact: true });
      const errorAlert = page.locator('.alert.alert-error');
      await expect(requestLink).toBeVisible();
      await expect(requestLink).toHaveCSS(
        'color',
        await errorAlert.evaluate((element) => getComputedStyle(element).color),
      );
      await requestLink.scrollIntoViewIfNeeded();
      const linkBox = await requestLink.boundingBox();
      expect(linkBox).not.toBeNull();
      expect(linkBox?.x).toBeGreaterThanOrEqual(0);
      expect((linkBox?.x ?? 0) + (linkBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect(linkBox?.y).toBeGreaterThanOrEqual(0);
      expect((linkBox?.y ?? 0) + (linkBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);

      if (viewport.height <= 390) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(
            `expired-reset-${mode}-${viewport.width}x${viewport.height}.png`,
          ),
          animations: 'disabled',
        });
      }

      await requestLink.click();
      await expect(page).toHaveURL(/\/forgot-password$/);
      await expect(
        page.getByRole('heading', { name: 'Forgot password', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
    }
  }
});
