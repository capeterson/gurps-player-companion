import { writeFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`trait-editor-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Trait Editor QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

test('expanded Traits and Skills editor headings wrap long names at mobile breakpoints', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const token = await register(page);
  async function create(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }

  const campaign = await create('/campaigns', { name: 'Trait heading layout' });
  const character = await create('/characters', {
    name: 'Responsive Surveyor',
    campaignId: campaign.id,
  });
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Traits');

  const longTrait =
    'PneumonoultramicroscopicsilicovolcanoconiosisResponsiveSurveyorTraitWithAnUnusuallyLongName';
  await page.getByRole('button', { name: '+ Add trait' }).click();
  await page.getByLabel('Trait name').fill(longTrait);
  await page.getByRole('button', { name: /^add$/i }).click();
  const editButton = page.getByRole('button', { name: `Edit ${longTrait}`, exact: true });
  await expect(editButton).toBeVisible();
  await editButton.click();

  const heading = page.getByRole('heading', { name: `Edit ${longTrait}`, exact: true });
  const nameInput = page.getByRole('textbox', { name: `${longTrait} name`, exact: true });
  const pointsInput = page.getByRole('textbox', { name: `${longTrait} points`, exact: true });
  for (const viewport of [
    { name: '320x568', width: 320, height: 568 },
    { name: '568x320', width: 568, height: 320 },
    { name: '639x800', width: 639, height: 800 },
    { name: '640x800', width: 640, height: 800 },
    { name: '641x800', width: 641, height: 800 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await heading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(`Edit ${longTrait}`);
    await expect(heading).toBeInViewport();
    const renderedHeading = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: element.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(renderedHeading.scrollWidth).toBeLessThanOrEqual(renderedHeading.clientWidth);
    expect(renderedHeading.height).toBeGreaterThan(renderedHeading.lineHeight);
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    if (viewport.width < 640) {
      expect(box?.height ?? 0).toBeGreaterThan(20);
    }

    await nameInput.scrollIntoViewIfNeeded();
    await expect(nameInput).toHaveValue(longTrait);
    await nameInput.focus();
    await nameInput.press('End');
    await expect(nameInput).toHaveValue(longTrait);
    const [nameBox, pointsBox] = await Promise.all([
      nameInput.boundingBox(),
      pointsInput.boundingBox(),
    ]);
    expect(nameBox).not.toBeNull();
    expect(pointsBox).not.toBeNull();
    expect(nameBox?.x).toBeGreaterThanOrEqual(0);
    expect((nameBox?.x ?? 0) + (nameBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect(pointsBox?.x).toBeGreaterThanOrEqual(0);
    expect((pointsBox?.x ?? 0) + (pointsBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);

    if (viewport.width === 320 || viewport.name === '568x320') {
      await heading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const screenshotPath = testInfo.outputPath(`trait-editor-heading-${viewport.name}.png`);
      const screenshot = await page.screenshot({ animations: 'disabled' });
      await writeFile(screenshotPath, screenshot);
      await testInfo.attach(`trait-editor-heading-${viewport.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
    }
  }

  await selectCharacterSection(page, 'Skills');
  const longSkill =
    'PneumonoultramicroscopicsilicovolcanoconiosisResponsiveSurveyorSkillWithAnUnusuallyLongName';
  await page.getByRole('button', { name: '+ Add skill' }).click();
  const skillForm = page.getByLabel(/^skill$/i).locator('xpath=ancestor::form');
  await page.getByLabel(/^skill$/i).fill(longSkill);
  await skillForm.getByRole('button', { name: /^add$/i }).click();
  const skillEditButton = page.getByRole('button', { name: `Edit ${longSkill}`, exact: true });
  await expect(skillEditButton).toBeVisible();
  await skillEditButton.click();

  const skillHeading = page.getByRole('heading', { name: `Edit ${longSkill}`, exact: true });
  const skillNameInput = page.getByRole('textbox', { name: `${longSkill} name`, exact: true });
  const skillPointsInput = page.getByRole('textbox', {
    name: `${longSkill} points`,
    exact: true,
  });
  for (const viewport of [
    { name: '320x568', width: 320, height: 568 },
    { name: '568x320', width: 568, height: 320 },
    { name: '639x800', width: 639, height: 800 },
    { name: '640x800', width: 640, height: 800 },
    { name: '641x800', width: 641, height: 800 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await skillHeading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(skillHeading).toBeVisible();
    await expect(skillHeading).toHaveText(`Edit ${longSkill}`);
    await expect(skillHeading).toBeInViewport();
    const renderedHeading = await skillHeading.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: element.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    });
    expect(renderedHeading.scrollWidth).toBeLessThanOrEqual(renderedHeading.clientWidth);
    expect(renderedHeading.height).toBeGreaterThan(renderedHeading.lineHeight);
    const box = await skillHeading.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    await skillNameInput.scrollIntoViewIfNeeded();
    await expect(skillNameInput).toHaveValue(longSkill);
    await skillNameInput.focus();
    await skillNameInput.press('End');
    await expect(skillNameInput).toHaveValue(longSkill);
    const [nameBox, pointsBox] = await Promise.all([
      skillNameInput.boundingBox(),
      skillPointsInput.boundingBox(),
    ]);
    expect(nameBox).not.toBeNull();
    expect(pointsBox).not.toBeNull();
    expect(nameBox?.x).toBeGreaterThanOrEqual(0);
    expect((nameBox?.x ?? 0) + (nameBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect(pointsBox?.x).toBeGreaterThanOrEqual(0);
    expect((pointsBox?.x ?? 0) + (pointsBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);

    if (viewport.width === 320 || viewport.name === '568x320') {
      await skillHeading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const screenshotPath = testInfo.outputPath(`skills-editor-heading-${viewport.name}.png`);
      const screenshot = await page.screenshot({ animations: 'disabled' });
      await writeFile(screenshotPath, screenshot);
      await testInfo.attach(`skills-editor-heading-${viewport.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
    }
  }
});
