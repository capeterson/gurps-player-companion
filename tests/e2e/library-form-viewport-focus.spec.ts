import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test.use({
  viewport: { width: 320, height: 568 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function create<T>(
  page: import('@playwright/test').Page,
  path: string,
  body: object,
): Promise<T> {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`/api/v1${path}`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function expectFocusedAndHittable(field: import('@playwright/test').Locator) {
  await expect
    .poll(() =>
      field.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        const toolbar = document.querySelector('.library-toolbar')?.getBoundingClientRect();
        const pageOffset = Number.parseFloat(
          getComputedStyle(
            element.closest('[style*="--library-scroll-offset"]') ?? document.body,
          ).getPropertyValue('--library-scroll-offset'),
        );
        const inside =
          document.activeElement === element &&
          hit !== null &&
          (hit === element || element.contains(hit)) &&
          bounds.top >=
            Math.max(toolbar?.bottom ?? 0, Number.isFinite(pageOffset) ? pageOffset : 0) &&
          bounds.bottom <= innerHeight;
        return inside
          ? true
          : JSON.stringify({
              width: innerWidth,
              bounds: { top: bounds.top, bottom: bounds.bottom },
              toolbarBottom: toolbar?.bottom,
              pageOffset,
              active: document.activeElement === element,
              hit: hit?.tagName,
            });
      }),
    )
    .toBe(true);
}

test('focused library fields remain reachable below the sticky toolbar after phone rotation and Tab', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`library-focus-viewport-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Library Focus QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).tap();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = await create<{ id: string }>(page, '/campaigns', {
    name: 'Library focus viewport QA',
  });
  await page.goto(`/campaigns/${campaign.id}/library?section=traits`);
  const addTrait = page.getByRole('button', { name: '+ Add trait', exact: true });
  await expect(addTrait).toBeVisible({ timeout: 20_000 });
  await addTrait.tap();

  const name = page.getByRole('textbox', { name: 'Name' });
  const nameLabel = page.getByText('Name', { exact: true });
  await name.tap();
  await name.fill('A focused trait draft retained through rotation');
  await expectFocusedAndHittable(name);

  await page.setViewportSize({ width: 568, height: 320 });
  await expect(name).toHaveValue('A focused trait draft retained through rotation');
  await expectFocusedAndHittable(name);
  await expect(nameLabel).toBeVisible();
  await expect
    .poll(() =>
      nameLabel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const toolbarBottom =
          document.querySelector('.library-toolbar')?.getBoundingClientRect().bottom ?? 0;
        return (
          rect.top >= toolbarBottom && hit !== null && (hit === element || element.contains(hit))
        );
      }),
    )
    .toBe(true);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('library-focused-name-after-phone-rotation.png'),
    animations: 'disabled',
  });

  const scrollBeforeSmallResize = await page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 569, height: 320 });
  await expectFocusedAndHittable(name);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeSmallResize);

  await page.keyboard.press('Tab');
  const kind = page.getByLabel('Kind');
  await expectFocusedAndHittable(kind);
  await expect(name).toHaveValue('A focused trait draft retained through rotation');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectFocusedAndHittable(kind);
  await expect(name).toHaveValue('A focused trait draft retained through rotation');

  const add = page.getByRole('button', { name: 'Add trait', exact: true });
  await add.scrollIntoViewIfNeeded();
  await add.tap();
  const row = page.getByRole('button', {
    name: 'A focused trait draft retained through rotation',
    exact: true,
  });
  await expect(row).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Edit A focused trait draft retained through rotation',
      exact: true,
    })
    .tap();

  const editName = page.getByRole('textbox', { name: 'Name' });
  await editName.tap();
  await editName.fill('An edited trait draft retained through rotation');
  await expectFocusedAndHittable(editName);
  const scrollBeforeVisibleResize = await page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 391, height: 844 });
  await expectFocusedAndHittable(editName);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeVisibleResize);

  await page.setViewportSize({ width: 320, height: 568 });
  await expectFocusedAndHittable(editName);
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(editName).toHaveValue('An edited trait draft retained through rotation');
  await expectFocusedAndHittable(editName);
  for (const width of [639, 640, 641]) {
    await page.setViewportSize({ width, height: 320 });
    await expectFocusedAndHittable(editName);
    await expect(editName).toHaveValue('An edited trait draft retained through rotation');
    await expect(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`library-focused-name-short-${width}.png`),
      animations: 'disabled',
    });
  }
  await page.keyboard.press('Tab');
  await expectFocusedAndHittable(page.getByLabel('Kind'));
  await expect(editName).toHaveValue('An edited trait draft retained through rotation');

  await page.setViewportSize({ width: 390, height: 844 });
  const toolbar = page.locator('.library-toolbar');
  await expect
    .poll(() => toolbar.evaluate((element) => getComputedStyle(element).position))
    .toBe('sticky');
  await expect(toolbar).toBeVisible();
  await expect
    .poll(() =>
      toolbar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      }),
    )
    .toBe(true);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('library-toolbar-sticky-restored-portrait.png'),
    animations: 'disabled',
  });
  const save = page.getByRole('button', { name: 'Save changes', exact: true });
  await save.scrollIntoViewIfNeeded();
  await save.tap();
  await expect(
    page.getByRole('button', {
      name: 'An edited trait draft retained through rotation',
      exact: true,
    }),
  ).toBeVisible();
});
