import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { expectCharacterNavigationReady } from './character-navigation';
import { captureReviewScreenshot, reviewArtifactsEnabled } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const missedCharacterName =
  'A Very Long Character Name For Someone Who Missed Session And Earned No Points';

async function readCampaignPatch(page: Page, attemptedValue: string | null) {
  return page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction('outbox').objectStore('outbox').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows.find((row) => row.fieldPath === 'campaignId' && row.attemptedValue === value);
    } finally {
      db.close();
    }
  }, attemptedValue);
}

function createAccountEmail() {
  return `landing-flow-${suffix()}@example.com`;
}

async function createCampaign(page: import('@playwright/test').Page, name: string) {
  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
  await page.getByRole('button', { name: `Settings for ${name}` }).click();
  await page.getByLabel('Point target').fill('150');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Point target')).toHaveCount(0);
  return page.getByRole('link', { name });
}

async function expectDialogInsideViewport(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
) {
  const dialog = page.getByRole('dialog');
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await expect(dialog.locator('.modal-box')).toHaveCSS('opacity', '1');
  const modalBox = await dialog.locator('.modal-box').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox?.x).toBeGreaterThanOrEqual(0);
  expect(modalBox?.y).toBeGreaterThanOrEqual(0);
  expect((modalBox?.x ?? 0) + (modalBox?.width ?? width)).toBeLessThanOrEqual(width);
  expect((modalBox?.y ?? 0) + (modalBox?.height ?? height)).toBeLessThanOrEqual(height);
  for (const button of await dialog.locator('.modal-action').getByRole('button').all()) {
    const buttonBox = await button.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox?.x).toBeGreaterThanOrEqual(modalBox?.x ?? 0);
    expect(buttonBox?.y).toBeGreaterThanOrEqual(modalBox?.y ?? 0);
    expect((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0)).toBeLessThanOrEqual(
      (modalBox?.x ?? 0) + (modalBox?.width ?? width),
    );
    expect((buttonBox?.y ?? 0) + (buttonBox?.height ?? 0)).toBeLessThanOrEqual(
      (modalBox?.y ?? 0) + (modalBox?.height ?? height),
    );
  }
}

async function openPointLedger(page: import('@playwright/test').Page) {
  const ledgerButton = page.getByRole('button', { name: /point ledger/i });
  if ((await ledgerButton.getAttribute('aria-expanded')) !== 'true') {
    await ledgerButton.click();
  }
  await expect(ledgerButton).toHaveAttribute('aria-expanded', 'true');
}

async function openCampaignEditor(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Edit campaign', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Change character campaign?' });
  await expect(warning).toBeVisible();
  return warning;
}

async function continueCampaignWarning(page: import('@playwright/test').Page) {
  const warning = await openCampaignEditor(page);
  await warning.getByRole('button', { name: 'Continue', exact: true }).click();
  const select = page.getByLabel('campaign', { exact: true });
  await expect(select).toBeVisible();
  return select;
}

async function chooseCampaign(page: import('@playwright/test').Page, name: string) {
  const select = await continueCampaignWarning(page);
  await select.selectOption({ label: name });
  return page.getByRole('dialog', { name: 'Are you sure?' });
}

async function setColorTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  const switchName = theme === 'dark' ? /switch to dark mode/i : /switch to light mode/i;
  const switcher = page.getByRole('button', { name: switchName });
  if (await switcher.isVisible().catch(() => false)) await switcher.click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    theme === 'dark' ? 'arcane-dark' : 'arcane-light',
  );
}

async function expectCampaignLinkAndPencil(
  page: import('@playwright/test').Page,
  campaignName: string,
  width: number,
  height: number,
) {
  const pencil = page.getByRole('button', { name: 'Edit campaign', exact: true });
  await pencil.scrollIntoViewIfNeeded();
  const wrapper = pencil.locator('xpath=..');
  const link = wrapper.getByRole('link', { name: campaignName, exact: true });
  await expect(link).toBeVisible();
  await expect(pencil).toBeVisible();
  const [container, linkBox, pencilBox] = await Promise.all([
    wrapper.boundingBox(),
    link.boundingBox(),
    pencil.boundingBox(),
  ]);
  expect(container).not.toBeNull();
  expect(linkBox).not.toBeNull();
  expect(pencilBox).not.toBeNull();
  expect(container?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((container?.x ?? 0) + (container?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(container?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((container?.y ?? 0) + (container?.height ?? 0)).toBeLessThanOrEqual(height);
  expect(linkBox?.x ?? -1).toBeGreaterThanOrEqual(container?.x ?? 0);
  expect((linkBox?.x ?? 0) + (linkBox?.width ?? 0)).toBeLessThanOrEqual(
    (container?.x ?? 0) + (container?.width ?? 0),
  );
  expect(pencilBox?.x ?? -1).toBeGreaterThanOrEqual(container?.x ?? 0);
  expect((pencilBox?.x ?? 0) + (pencilBox?.width ?? 0)).toBeLessThanOrEqual(
    (container?.x ?? 0) + (container?.width ?? 0),
  );
  const horizontalOverlap =
    (linkBox?.x ?? 0) < (pencilBox?.x ?? 0) + (pencilBox?.width ?? 0) &&
    (pencilBox?.x ?? 0) < (linkBox?.x ?? 0) + (linkBox?.width ?? 0);
  const verticalOverlap =
    (linkBox?.y ?? 0) < (pencilBox?.y ?? 0) + (pencilBox?.height ?? 0) &&
    (pencilBox?.y ?? 0) < (linkBox?.y ?? 0) + (linkBox?.height ?? 0);
  expect(horizontalOverlap && verticalOverlap).toBe(false);
}

test('README screenshots match the unauthenticated landing page assets', async () => {
  const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
  const landing = readFileSync(
    resolve(process.cwd(), 'src/client/features/home/LandingPage.tsx'),
    'utf8',
  );
  const readmeScreenshots = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1] ?? '')
    .filter((source) => source.includes('screenshots/'))
    .map((source) => source.split('/').at(-1) ?? '')
    .sort();
  const landingScreenshots = [...landing.matchAll(/src="(\/screenshots\/[^\"]+)"/g)]
    .map((match) => match[1]?.split('/').at(-1) ?? '')
    .sort();

  expect(landingScreenshots.length).toBeGreaterThan(0);
  expect(readmeScreenshots.length).toBeGreaterThan(landingScreenshots.length);
  for (const screenshot of landingScreenshots) {
    expect(readmeScreenshots).toContain(screenshot);
    expect(existsSync(resolve(process.cwd(), 'public/screenshots', screenshot))).toBe(true);
  }
  for (const markdownPath of [...readme.matchAll(/!\[[^\]]*\]\(([^)]+screenshots\/[^)]+)\)/g)].map(
    (match) => match[1] ?? '',
  )) {
    expect(markdownPath).toMatch(/^public\/screenshots\//);
    expect(existsSync(resolve(process.cwd(), markdownPath))).toBe(true);
  }
});

test('landing hero headline keeps its intended two lines across responsive breakpoints', async ({
  page,
}, testInfo) => {
  const viewportCases = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 639, height: 700 },
    { width: 640, height: 700 },
    { width: 641, height: 700 },
    { width: 767, height: 900 },
    { width: 768, height: 900 },
    { width: 769, height: 900 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
    { width: 1023, height: 768 },
    { width: 1024, height: 768 },
    { width: 1025, height: 768 },
    { width: 1279, height: 800 },
    { width: 1280, height: 800 },
    { width: 1281, height: 800 },
  ];

  await page.goto('/');
  const heading = page.getByRole('heading', {
    name: 'Your next adventure. All on one sheet.',
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/Your next adventure\.\s*All on one sheet\./);

  for (const viewport of viewportCases) {
    await page.setViewportSize(viewport);
    const geometry = await heading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        lineHeight: Number.parseFloat(style.lineHeight),
        scrollWidth: element.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= 639) {
      expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2 + 1);
    }
    if (viewport.height <= 390) {
      expect(geometry.y).toBeGreaterThanOrEqual(0);
      expect(geometry.y + geometry.height).toBeLessThanOrEqual(viewport.height);
    }

    if ([639, 640, 641].includes(viewport.width) || viewport.height <= 390) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`landing-hero-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    }
  }
});

test('public landing, classic palette, Overview default, and campaign reassignment warning work', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /your next adventure/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /create your account/i })).toHaveAttribute(
    'href',
    '/register',
  );
  await expect(page.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('img', { name: /GPC combat sheet/i })).toBeVisible();
  await expect(
    page.getByRole('img', { name: /GPC Combat section showing armor coverage/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /GPC inventory in Illuminated Manuscript/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /built for long sessions|make it your companion/i }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: /explore the project on github/i })).toBeVisible();

  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await captureReviewScreenshot(page, {
      path: `test-results/landing-${width}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const screenshots = page.getByRole('img');
    await expect(screenshots).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const image = screenshots.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      const box = await image.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? width)).toBeLessThanOrEqual(width);
    }
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(createAccountEmail());
  await page.getByLabel(/display name/i).fill('Landing and Campaign QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/settings');
  const darkTheme = page.getByLabel('Dark theme');
  await expect(darkTheme).toBeVisible();
  await darkTheme.selectOption('arcane-dark');
  await page.getByRole('button', { name: /switch to dark mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'arcane-dark');
  const lightTheme = page.getByLabel('Light theme');
  await expect(lightTheme).toContainText('Arcane Purple');
  await lightTheme.selectOption('arcane-light');
  await page.getByRole('button', { name: /switch to light mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'arcane-light');

  const firstCampaignName = `CampaignA${'AmberMarchesUnbrokenName'.repeat(2)} ${suffix()}`;
  await createCampaign(page, firstCampaignName);
  const secondCampaignName = `CampaignB${'SapphireCoastUnbrokenName'.repeat(2)} ${suffix()}`;
  await createCampaign(page, secondCampaignName);

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Campaign Assignment QA');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/);
  await expectCharacterNavigationReady(page);
  await expect(
    page.locator('.sheet-dock').getByRole('button', { name: 'Overview' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();

  const campaignSelect = page.getByLabel('campaign', { exact: true });
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const initialWarning = await openCampaignEditor(page);
  await expect(initialWarning).toContainText(/may impact your character sheet/i);
  await initialWarning.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(campaignSelect).toBeVisible();
  await campaignSelect.selectOption({ label: firstCampaignName });
  const firstCampaignId = await campaignSelect
    .locator('option', { hasText: firstCampaignName })
    .getAttribute('value');
  expect(firstCampaignId).toMatch(/^[0-9a-f-]{36}$/i);
  const firstAssignmentConfirm = page.getByRole('dialog', { name: 'Are you sure?' });
  await expect(firstAssignmentConfirm).toContainText('No campaign');
  await expect(firstAssignmentConfirm).toContainText(firstCampaignName);
  await expectDialogInsideViewport(page, 1280, 900);
  await firstAssignmentConfirm
    .getByRole('button', { name: 'Change campaign', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: firstCampaignName, exact: true }).last(),
  ).toBeVisible();
  await expect.poll(() => readCampaignPatch(page, firstCampaignId ?? null)).toBeTruthy();
  const offlineCharacterId = new URL(page.url()).pathname.split('/').at(-1);
  if (!offlineCharacterId) throw new Error('missing character ID in the current route');
  const localCampaignId = await page.evaluate(async (characterId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('characters').objectStore('characters').get(characterId);
        request.onsuccess = () => resolve(request.result?.campaignId ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, offlineCharacterId);
  expect(localCampaignId).toBe(firstCampaignId);
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(() => readCampaignPatch(page, firstCampaignId ?? null), { timeout: 15_000 })
    .toBeFalsy();
  const serverAssignment = await page.evaluate(async (characterId) => {
    const stored = localStorage.getItem('gpc.tokenPair.v1');
    if (!stored) throw new Error('missing browser token pair');
    const tokenPair = JSON.parse(stored) as { accessToken: string };
    const response = await fetch(`/api/v1/characters/${characterId}`, {
      headers: { Authorization: `Bearer ${tokenPair.accessToken}` },
    });
    return {
      status: response.status,
      character: (await response.json()) as { campaignId?: string | null },
    };
  }, offlineCharacterId);
  expect(serverAssignment.status).toBe(200);
  expect(serverAssignment.character.campaignId).toBe(firstCampaignId);
  const assignedCharacterUrl = page.url();
  const firstCampaignHref = await page
    .getByRole('link', { name: firstCampaignName, exact: true })
    .last()
    .getAttribute('href');
  expect(firstCampaignHref).toMatch(/^\/campaigns\//);
  const firstCampaignUrl = new URL(firstCampaignHref ?? '', page.url()).toString();
  await page.getByRole('link', { name: firstCampaignName, exact: true }).last().click();
  await expect(page).toHaveURL(firstCampaignUrl);
  await page.goto(assignedCharacterUrl);
  await expectCharacterNavigationReady(page);
  await openPointLedger(page);
  const initialPointCap = Number(
    await page
      .getByText('Point cap', { exact: true })
      .locator('xpath=..')
      .locator('span')
      .nth(1)
      .innerText(),
  );

  const widths = [320, 375, 390, 430, 575, 639, 640, 641, 767, 768, 769, 1023, 1024, 1025];
  for (const theme of ['light', 'dark'] as const) {
    await setColorTheme(page, theme);
    for (const width of [320, 375, 575, 639, 640, 641, 767, 768, 769, 1023, 1024, 1025]) {
      const height = width < 768 ? 844 : 900;
      await page.setViewportSize({ width, height });
      await expectCampaignLinkAndPencil(page, firstCampaignName, width, height);
      if ([375, 575].includes(width)) {
        if (reviewArtifactsEnabled) await page.waitForTimeout(350);
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`campaign-link-pencil-${theme}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
    for (const width of widths) {
      const height = width < 768 ? 844 : 900;
      await page.setViewportSize({ width, height });
      const warning = await openCampaignEditor(page);
      await expect(warning).toContainText(/may impact your character sheet/i);
      await expect(warning).toContainText(/rejoining the campaign later/i);
      await expectDialogInsideViewport(page, width, height);
      if ([320, 375, 640, 768].includes(width)) {
        if (reviewArtifactsEnabled) await page.waitForTimeout(350);
        await captureReviewScreenshot(page, {
          path: `test-results/campaign-warning-${theme}-${width}.png`,
          animations: 'disabled',
        });
      }
      await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(warning).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: firstCampaignName, exact: true }).last(),
      ).toBeVisible();

      const select = await continueCampaignWarning(page);
      await select.selectOption({ label: secondCampaignName });
      const finalConfirmation = page.getByRole('dialog', { name: 'Are you sure?' });
      await expect(finalConfirmation).toContainText(firstCampaignName);
      await expect(finalConfirmation).toContainText(secondCampaignName);
      await expectDialogInsideViewport(page, width, height);
      if ([320, 375, 640, 768].includes(width)) {
        if (reviewArtifactsEnabled) await page.waitForTimeout(350);
        await captureReviewScreenshot(page, {
          path: `test-results/campaign-final-confirmation-${theme}-${width}.png`,
          animations: 'disabled',
        });
      }
      await finalConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByLabel('campaign', { exact: true })).toHaveValue(
        (await page
          .getByLabel('campaign', { exact: true })
          .locator('option', { hasText: firstCampaignName })
          .getAttribute('value')) ?? '',
      );
      await page.getByRole('button', { name: 'Cancel editing campaign', exact: true }).click();
    }
  }

  await setColorTheme(page, 'light');
  await page.setViewportSize({ width: 1280, height: 900 });
  const confirmation = await chooseCampaign(page, secondCampaignName);
  await confirmation.getByRole('button', { name: 'Change campaign', exact: true }).click();
  await expect(
    page.getByRole('link', { name: secondCampaignName, exact: true }).last(),
  ).toBeVisible();

  // Selecting the current campaign leaves the character assignment alone.
  const unchangedSelect = await continueCampaignWarning(page);
  await unchangedSelect.selectOption({ label: secondCampaignName });
  await expect(page.getByRole('dialog', { name: 'Are you sure?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel editing campaign', exact: true }).click();

  const awardedCharacterUrl = page.url();
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(missedCharacterName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  const missedCharacterUrl = page.url();
  const missedAssignment = await chooseCampaign(page, secondCampaignName);
  await missedAssignment.getByRole('button', { name: 'Change campaign', exact: true }).click();
  await expect(
    page.getByRole('link', { name: secondCampaignName, exact: true }).last(),
  ).toBeVisible();

  await page.goto('/campaigns');
  await page.getByRole('link', { name: secondCampaignName }).click();
  await page
    .getByRole('navigation', { name: 'Campaign sections' })
    .getByRole('link', { name: 'Adventure log' })
    .click();
  await page.getByRole('button', { name: /new entry/i }).click();
  await page.getByLabel('Title').fill('Awarded session');
  await page.getByText('Points gained (optional)').locator('xpath=..').locator('input').fill('4');
  for (const width of [320, 390, 430, 767, 768, 769]) {
    const height = width < 768 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.getByRole('button', { name: 'Choose characters' }).click();
    const recipients = page.getByRole('dialog', { name: 'Apply points to characters' });
    await expect(recipients.getByRole('checkbox')).toHaveCount(2);
    await expect(recipients.getByRole('button', { name: 'Select all characters' })).toBeVisible();
    await expect(recipients.getByRole('button', { name: 'Use selected characters' })).toBeVisible();
    await expectDialogInsideViewport(page, width, height);
    if (width === 320 || width === 768) {
      if (reviewArtifactsEnabled) await page.waitForTimeout(350);
      await captureReviewScreenshot(page, {
        path: `test-results/recipient-subset-${width}.png`,
        animations: 'disabled',
      });
    }
    await recipients.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(recipients).toHaveCount(0);
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole('button', { name: 'Choose characters' }).click();
  const recipients = page.getByRole('dialog', { name: 'Apply points to characters' });
  const missedSessionLabel = recipients
    .getByText(missedCharacterName, { exact: true })
    .locator('xpath=..');
  await missedSessionLabel.getByRole('checkbox').uncheck();
  await recipients.getByRole('button', { name: 'Use selected characters' }).click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('4 points gained · 1 character')).toBeVisible();

  await page.goto(awardedCharacterUrl);
  await expectCharacterNavigationReady(page);
  await openPointLedger(page);
  const earnedPointsLine = page.getByText('Earned points', { exact: true }).locator('xpath=..');
  await expect(earnedPointsLine).toBeVisible();
  await expect(earnedPointsLine).toContainText('4');
  const awardedPointCap = page.getByText('Point cap', { exact: true }).locator('xpath=..');
  await expect(awardedPointCap).toContainText(String(initialPointCap + 4));

  const finalCampaignSelect = page.getByLabel('campaign', { exact: true });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const leaveDialog = await openCampaignEditor(page);
    await expect(leaveDialog).toBeVisible();
    await expectDialogInsideViewport(page, width, 900);
    if (width === 320) {
      if (reviewArtifactsEnabled) await page.waitForTimeout(350);
      await captureReviewScreenshot(page, {
        path: 'test-results/campaign-leave-320.png',
        animations: 'disabled',
      });
    }
    await leaveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('link', { name: secondCampaignName, exact: true }).last(),
    ).toBeVisible();

    const select = await continueCampaignWarning(page);
    await select.selectOption('');
    const confirmationToLeave = page.getByRole('dialog', { name: 'Are you sure?' });
    await expectDialogInsideViewport(page, width, 900);
    await confirmationToLeave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(finalCampaignSelect).toHaveValue(
      (await finalCampaignSelect
        .locator('option', { hasText: secondCampaignName })
        .getAttribute('value')) ?? '',
    );
    await page.getByRole('button', { name: 'Cancel editing campaign', exact: true }).click();
  }

  const leaveConfirmed = await chooseCampaign(page, 'No campaign');
  await expect(leaveConfirmed).toBeVisible();
  await expectDialogInsideViewport(page, 768, 900);
  if (reviewArtifactsEnabled) await page.waitForTimeout(350);
  await captureReviewScreenshot(page, {
    path: 'test-results/campaign-leave-768.png',
    animations: 'disabled',
  });
  await leaveConfirmed.getByRole('button', { name: 'Change campaign', exact: true }).click();
  await expect(leaveConfirmed).toHaveCount(0);
  await expect(page.getByLabel('campaign', { exact: true })).toHaveCount(0);
  await expect(
    page.locator('.label-eyebrow', { hasText: 'Campaign' }).locator('xpath=..'),
  ).toContainText('No campaign');

  await page.goto(missedCharacterUrl);
  await expectCharacterNavigationReady(page);
  await openPointLedger(page);
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(
    missedCharacterName,
  );
  await expect(page.getByRole('dialog', { name: 'Change character campaign?' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: secondCampaignName, exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText('Earned points', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Point cap', { exact: true }).locator('xpath=..')).toContainText(
    String(initialPointCap),
  );

  // Exercise a param-to-param SPA history transition with the campaign warning open.
  await page.getByRole('link', { name: /all characters/i }).click();
  await page.getByRole('link', { name: 'Campaign Assignment QA' }).click();
  await expectCharacterNavigationReady(page);
  await openCampaignEditor(page);
  await page.evaluate(() => window.history.go(-2));
  await expect(page).toHaveURL(missedCharacterUrl);
  await expectCharacterNavigationReady(page);
  await openPointLedger(page);
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(
    missedCharacterName,
  );
  await expect(page.getByRole('dialog', { name: 'Change character campaign?' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: secondCampaignName, exact: true }).last(),
  ).toBeVisible();
});
