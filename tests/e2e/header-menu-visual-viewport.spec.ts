import { type Locator, type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const password = 'CorrectHorseBatteryStaple1';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

async function settleViewport(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function expectOverlayInsideVisualViewport(_page: Page, overlay: Locator) {
  await expect(overlay).toBeVisible();
  await expect
    .poll(async () =>
      overlay.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const visual = window.visualViewport;
        const left = visual?.offsetLeft ?? 0;
        const top = visual?.offsetTop ?? 0;
        const right = left + (visual?.width ?? window.innerWidth);
        const bottom = top + (visual?.height ?? window.innerHeight);
        const inside =
          rect.left >= left + 7.5 &&
          rect.top >= top + 7.5 &&
          rect.right <= right - 7.5 &&
          rect.bottom <= bottom - 7.5;
        return inside
          ? true
          : JSON.stringify({
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              visual: { left, top, right, bottom, scale: visual?.scale ?? 1 },
              maxHeight: getComputedStyle(element).maxHeight,
              availableHeight: element.style.getPropertyValue(
                '--viewport-overlay-available-height',
              ),
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
            });
      }),
    )
    .toBe(true);
}

async function expectReachableAfterScroll(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await settleViewport(page);
  await expect
    .poll(async () =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const visual = window.visualViewport;
        const left = visual?.offsetLeft ?? 0;
        const top = visual?.offsetTop ?? 0;
        const right = left + (visual?.width ?? window.innerWidth);
        const bottom = top + (visual?.height ?? window.innerHeight);
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const panel = element.closest('.dropdown-content')?.getBoundingClientRect();
        return (
          panel !== undefined &&
          rect.left >= panel.left &&
          rect.top >= panel.top &&
          rect.right <= panel.right &&
          rect.bottom <= panel.bottom &&
          rect.left >= left &&
          rect.top >= top &&
          rect.right <= right &&
          rect.bottom <= bottom &&
          (hit === element || element.contains(hit))
        );
      }),
    )
    .toBe(true);
}

test('account and compact character menus remain touch reachable through resize and pinch zoom', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `touch-shell-${suffix()}-${'long-account-address-'.repeat(3)}@example.com`;
  const characterName = `${'ResponsiveTouchCharacterNameWithoutSpaces'.repeat(3).slice(0, 112)}`;

  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Touch Shell QA With A Long Display Name');
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).tap();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(characterName);
  await page.getByRole('button', { name: /^create$/i }).tap();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+$/i, { timeout: 15_000 });
  const characterUrl = page.url();
  await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });

  const cdp = await page.context().newCDPSession(page);
  const compactViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 1279, height: 768 },
    { width: 1280, height: 768 },
    { width: 1281, height: 768 },
  ];
  const compactNav = page.getByRole('navigation', { name: 'Character and app navigation' });

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await settleViewport(page);

    if (viewport.width >= 1280) {
      await expect(compactNav).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      continue;
    }

    const trigger = compactNav.locator('summary');
    await trigger.tap();
    const menu = compactNav.locator('ul.dropdown-content');
    await expect(menu).toContainText(characterName);
    await expectOverlayInsideVisualViewport(page, menu);
    const logout = menu.getByRole('button', { name: 'Logout', exact: true });
    await expectReachableAfterScroll(page, logout);

    if (
      (viewport.width === 568 && viewport.height === 320) ||
      (viewport.width === 844 && viewport.height === 390)
    ) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`compact-menu-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    }
    await trigger.tap();
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  const compactTrigger = compactNav.locator('summary');
  await compactTrigger.tap();
  const compactMenu = compactNav.locator('ul.dropdown-content');
  for (const scale of [1.25, 1.5]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await settleViewport(page);
    await expectOverlayInsideVisualViewport(page, compactMenu);
    await expectReachableAfterScroll(
      page,
      compactMenu.getByRole('button', { name: 'Logout', exact: true }),
    );
    if (scale === 1.5) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('compact-menu-pinch-150.png'),
        animations: 'disabled',
      });
    }
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await compactTrigger.tap();

  await page.setViewportSize({ width: 320, height: 568 });
  await compactTrigger.tap();
  for (const scale of [2, 1]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await settleViewport(page);
    await expect(compactMenu).toContainText(characterName);
    await expectOverlayInsideVisualViewport(page, compactMenu);
    await expectReachableAfterScroll(
      page,
      compactMenu.getByRole('button', { name: 'Logout', exact: true }),
    );
    await settleViewport(page);
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`compact-menu-portrait-scale-${scale}.png`),
      animations: 'disabled',
    });
    if (scale === 2) {
      await compactMenu.getByRole('button', { name: 'Logout', exact: true }).tap();
      await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/^password\b/i).fill(password);
      await page.getByRole('button', { name: /^sign in$/i }).tap();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
        timeout: 15_000,
      });
      await page.goto(characterUrl);
      await expect(compactTrigger).toBeVisible();
      await compactTrigger.tap();
    }
  }
  await compactTrigger.tap();

  await compactNav.locator('summary').tap();
  const openCompactMenu = compactNav.locator('ul.dropdown-content');
  await expectOverlayInsideVisualViewport(page, openCompactMenu);

  const switchToDark = openCompactMenu.getByRole('button', { name: 'Switch to Dark mode' });
  await expectReachableAfterScroll(page, switchToDark);
  await switchToDark.tap();
  const switchToLight = openCompactMenu.getByRole('button', { name: 'Switch to Light mode' });
  await expectReachableAfterScroll(page, switchToLight);
  await switchToLight.tap();

  const about = openCompactMenu.getByRole('link', { name: 'About', exact: true });
  await expectReachableAfterScroll(page, about);
  await about.tap();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { name: 'GURPS Player Companion' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(characterUrl);
  await expect(compactNav.locator('summary')).toBeVisible();

  await page.goto('/');
  const accountViewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 844, height: 390 },
    { width: 1279, height: 768 },
    { width: 1280, height: 768 },
    { width: 1281, height: 768 },
  ];
  const userMenuTrigger = page.locator('header.app-header summary[aria-label="Open user menu"]');

  for (const viewport of accountViewports) {
    await page.setViewportSize(viewport);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await settleViewport(page);
    await userMenuTrigger.tap();
    const accountMenu = page.locator(
      'details.dropdown[open]:has(> summary[aria-label="Open user menu"]) ul.dropdown-content',
    );
    await expect(accountMenu).toContainText(email);
    await expectOverlayInsideVisualViewport(page, accountMenu);
    await expectReachableAfterScroll(page, accountMenu.getByRole('button', { name: 'Logout' }));
    await userMenuTrigger.tap();
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await userMenuTrigger.tap();
  const accountMenu = page.locator(
    'details.dropdown[open]:has(> summary[aria-label="Open user menu"]) ul.dropdown-content',
  );
  for (const scale of [1.25, 1.5]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await settleViewport(page);
    await expect(accountMenu).toContainText(email);
    await expectOverlayInsideVisualViewport(page, accountMenu);
    await expectReachableAfterScroll(page, accountMenu.getByRole('button', { name: 'Logout' }));
    if (scale === 1.5) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('account-menu-pinch-150.png'),
        animations: 'disabled',
      });
    }
  }

  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.setViewportSize({ width: 320, height: 568 });
  for (const scale of [2, 1, 2]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await settleViewport(page);
    await expect(accountMenu).toContainText(email);
    await expectOverlayInsideVisualViewport(page, accountMenu);
    await expectReachableAfterScroll(page, accountMenu.getByRole('button', { name: 'Logout' }));
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`account-menu-portrait-scale-${scale}.png`),
      animations: 'disabled',
    });
  }
  await accountMenu.getByRole('button', { name: 'Logout' }).tap();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  await cdp.detach();
});
