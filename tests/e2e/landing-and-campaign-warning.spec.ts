import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectCharacterNavigationReady } from './character-navigation';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

function createAccountEmail() {
  return `landing-flow-${suffix()}@example.com`;
}

async function createCampaign(page: import('@playwright/test').Page, name: string) {
  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
  return page.getByRole('link', { name });
}

async function expectDialogInsideViewport(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
) {
  const dialog = page.getByRole('dialog');
  const modalBox = await dialog.locator('.modal-box').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox?.x).toBeGreaterThanOrEqual(0);
  expect(modalBox?.y).toBeGreaterThanOrEqual(0);
  expect((modalBox?.x ?? 0) + (modalBox?.width ?? width)).toBeLessThanOrEqual(width);
  expect((modalBox?.y ?? 0) + (modalBox?.height ?? height)).toBeLessThanOrEqual(height);
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

test('public landing, classic palette, Overview default, and campaign reassignment warning work', async ({
  page,
}) => {
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

  const firstCampaignName = `Campaign A ${suffix()}`;
  await createCampaign(page, firstCampaignName);
  const secondCampaignName = `Campaign B ${suffix()}`;
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

  const campaignSelect = page.getByLabel('campaign');
  await campaignSelect.selectOption({ label: firstCampaignName });
  await expect(campaignSelect).toHaveValue(
    (await campaignSelect
      .locator('option', { hasText: firstCampaignName })
      .getAttribute('value')) ?? '',
  );
  await expect(page.getByRole('dialog', { name: 'Change character campaign?' })).toHaveCount(0);

  const widths = [320, 390, 430, 767, 768, 769];
  for (const width of widths) {
    const height = width < 768 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await campaignSelect.selectOption({ label: secondCampaignName });
    const dialog = page.getByRole('dialog', { name: 'Change character campaign?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/may impact your character sheet/i);
    await expect(dialog).toContainText(/rejoining the campaign later/i);
    await expectDialogInsideViewport(page, width, height);
    if (width === 320 || width === 768) {
      await page.screenshot({ path: `test-results/campaign-warning-${width}.png` });
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(campaignSelect).toHaveValue(
      (await campaignSelect
        .locator('option', { hasText: firstCampaignName })
        .getAttribute('value')) ?? '',
    );
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await campaignSelect.selectOption({ label: secondCampaignName });
  const confirmation = page.getByRole('dialog', { name: 'Change character campaign?' });
  await confirmation.getByRole('button', { name: 'Change campaign', exact: true }).click();
  await expect(campaignSelect).toHaveValue(
    (await campaignSelect
      .locator('option', { hasText: secondCampaignName })
      .getAttribute('value')) ?? '',
  );

  // Selecting the current campaign leaves the character assignment alone.
  await campaignSelect.selectOption({ label: secondCampaignName });
  await expect(page.getByRole('dialog', { name: 'Change character campaign?' })).toHaveCount(0);

  const awardedCharacterUrl = page.url();
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Missed Session QA');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expectCharacterNavigationReady(page);
  await page.getByLabel('campaign').selectOption({ label: secondCampaignName });
  await expect(page.getByLabel('campaign')).toHaveValue(
    (await page
      .getByLabel('campaign')
      .locator('option', { hasText: secondCampaignName })
      .getAttribute('value')) ?? '',
  );

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
    await expect(recipients).toContainText('Leave out characters whose players missed the session');
    await expectDialogInsideViewport(page, width, height);
    if (width === 320 || width === 768) {
      await page.screenshot({ path: `test-results/recipient-subset-${width}.png` });
    }
    await recipients.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(recipients).toHaveCount(0);
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole('button', { name: 'Choose characters' }).click();
  const recipients = page.getByRole('dialog', { name: 'Apply points to characters' });
  const missedSessionLabel = recipients
    .getByText('Missed Session QA', { exact: true })
    .locator('xpath=..');
  await missedSessionLabel.getByRole('checkbox').uncheck();
  await recipients.getByRole('button', { name: 'Use selected characters' }).click();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('4 points gained · 1 character')).toBeVisible();

  await page.goto(awardedCharacterUrl);
  await expectCharacterNavigationReady(page);
  const earnedPointsLine = page.getByText('Earned points', { exact: true }).locator('xpath=..');
  await expect(earnedPointsLine).toContainText('4');

  const finalCampaignSelect = page.getByLabel('campaign');
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await finalCampaignSelect.selectOption('');
    const leaveDialog = page.getByRole('dialog', { name: 'Change character campaign?' });
    await expect(leaveDialog).toBeVisible();
    await expectDialogInsideViewport(page, width, 900);
    if (width === 320) await page.screenshot({ path: 'test-results/campaign-leave-320.png' });
    await leaveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(finalCampaignSelect).toHaveValue(
      (await finalCampaignSelect
        .locator('option', { hasText: secondCampaignName })
        .getAttribute('value')) ?? '',
    );
  }

  await finalCampaignSelect.selectOption('');
  const leaveConfirmed = page.getByRole('dialog', { name: 'Change character campaign?' });
  await expect(leaveConfirmed).toBeVisible();
  await expectDialogInsideViewport(page, 768, 900);
  await page.screenshot({ path: 'test-results/campaign-leave-768.png' });
  await leaveConfirmed.getByRole('button', { name: 'Change campaign' }).click();
  await expect(finalCampaignSelect).toHaveValue('');
});
