import type { Locator, Page, TestInfo } from '@playwright/test';

/** Success screenshots are review artifacts, not snapshot assertions. */
export const reviewArtifactsEnabled = process.env.PLAYWRIGHT_REVIEW_ARTIFACTS === '1';

type ScreenshotTarget = Page | Locator;
type ScreenshotOptions = Parameters<Page['screenshot']>[0];

export async function captureReviewScreenshot(
  target: ScreenshotTarget,
  options?: ScreenshotOptions,
) {
  if (!reviewArtifactsEnabled) return;
  await target.screenshot(options);
}

export async function attachReviewScreenshot(
  target: ScreenshotTarget,
  testInfo: TestInfo,
  name: string,
  options?: ScreenshotOptions,
) {
  if (!reviewArtifactsEnabled) return;
  const body = await target.screenshot(options);
  await testInfo.attach(name, { body, contentType: 'image/png' });
}
