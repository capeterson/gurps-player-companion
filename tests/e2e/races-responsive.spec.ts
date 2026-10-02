import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function create<T>(page: import('@playwright/test').Page, path: string, body: object) {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`/api/v1${path}`, {
    data: body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function geometry(locator: import('@playwright/test').Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Race dialog has no visible bounding box');
  return box;
}

const widths = [320, 639, 640, 641, 767, 768, 769, 1280];

test('race choice previews safely and campaign race definitions support UI CRUD', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`race-e2e-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Synthetic Race QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = await create<{ id: string }>(page, '/campaigns', {
    name: `Synthetic race campaign ${suffix()}`,
  });
  const character = await create<{ id: string }>(page, '/characters', {
    name: 'Synthetic Race Explorer',
    campaignId: campaign.id,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
  });

  await page.goto(`/campaigns/${campaign.id}/library?section=races`);
  await expect(page.getByRole('button', { name: '+ Add race', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const raceName = 'Synthetic Scholar with an intentionally long name for narrow viewports';
  const variantName =
    'Northwood caste with a long ceremonial name to exercise narrow viewport wrapping';
  const lensName = 'Synthetic Night Sight lens with a long title for mobile wrapping';
  await page.getByRole('button', { name: '+ Add race', exact: true }).click();
  await page.getByLabel('Race or lens name').fill(raceName);
  await page.getByLabel('Package points').first().fill('25');
  await page.getByText('Component traits · 0', { exact: true }).click();
  await page.getByRole('button', { name: 'Add component trait' }).click();
  await page.getByLabel('Trait name').fill('Acute Vision');
  await page.getByLabel('Trait points').fill('2');
  await page.getByLabel('Component key').fill('acute-vision');
  await page.getByText('Variants · 0', { exact: true }).click();
  await page.getByRole('button', { name: 'Add variant' }).click();
  await page.getByLabel('Option name').fill(variantName);
  await page.getByLabel('Option key').fill('northwood');
  await page.getByLabel('Package points').nth(1).fill('30');
  const variantGroup = page.getByRole('group', { name: 'Variants 1' });
  await variantGroup.getByLabel('ST', { exact: true }).fill('1');
  await variantGroup
    .getByLabel('Features (one per line)')
    .fill(
      'A ceremonial forest tradition described with enough synthetic detail to confirm preview text wraps cleanly on a phone.',
    );
  await variantGroup.getByText('Racial skill purchases · 0', { exact: true }).click();
  await variantGroup.getByRole('button', { name: 'Add racial skill' }).click();
  await variantGroup.getByLabel('Skill name').fill('Forest Lore');
  await variantGroup.getByLabel('Purchased points').fill('2');
  const racialSkillFields = variantGroup.getByRole('group', { name: 'Skill 1' });
  await racialSkillFields.locator('select').nth(0).selectOption('IQ');
  await racialSkillFields.locator('select').nth(1).selectOption('A');
  await page.getByText('Alternate forms · 0', { exact: true }).click();
  await page.getByRole('button', { name: 'Add form' }).click();
  await page.getByLabel('Option name').nth(1).fill('Owl form');
  await page.getByLabel('Option key').nth(1).fill('owl-form');
  await page
    .getByRole('group', { name: 'Alternate forms 1' })
    .getByLabel('ST', { exact: true })
    .fill('2');
  const raceNameField = page.getByLabel('Race or lens name');
  await raceNameField.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('race-editor-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await raceNameField.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('race-editor-mobile.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await variantGroup.scrollIntoViewIfNeeded();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('race-variant-editor-desktop.png'),
    animations: 'disabled',
  });
  await raceNameField.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  const raceRow = page.getByRole('button', { name: raceName, exact: true });
  await expect(raceRow).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: '+ Add race', exact: true }).click();
  await page.getByLabel('Race or lens name').fill(lensName);
  await page.getByLabel('Definition type').selectOption('lens');
  await page.getByLabel('Package points').first().fill('5');
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  await expect(page.getByRole('button', { name: lensName, exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const editRace = page.getByRole('button', { name: `Edit ${raceName}` });
  await editRace.click();
  await page.getByLabel('Race or lens name').fill(`${raceName} revised`);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const revisedName = `${raceName} revised`;
  await expect(page.getByRole('button', { name: revisedName, exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Overview');
  const raceButton = page.getByRole('button', { name: 'Change race: Human', exact: true });
  await expect(raceButton).toBeVisible();
  await expect(page.getByText('Race', { exact: true }).last()).toBeVisible();
  const ledger = page.getByRole('button', { name: /Point ledger/ });
  await ledger.click();
  const raceLedgerRow = page
    .locator('li')
    .filter({ has: page.getByText('Race', { exact: true }) })
    .first();
  await expect(raceLedgerRow).toContainText('0');
  await ledger.click();
  await raceButton.click();
  const dialog = page.getByRole('dialog', { name: 'Choose race' });
  await expect(dialog).toBeVisible();
  const raceSelect = dialog.locator('select').first();
  await expect(raceSelect.locator('option').filter({ hasText: revisedName })).toHaveCount(1, {
    timeout: 20_000,
  });
  const raceId = await raceSelect
    .locator('option')
    .filter({ hasText: revisedName })
    .getAttribute('value');
  if (!raceId) throw new Error('Synthetic race did not appear in the race selector');
  await raceSelect.selectOption(raceId);
  await dialog.getByLabel('Variant').selectOption('northwood');
  await dialog.getByLabel('Current form').selectOption('owl-form');
  await dialog.getByLabel(lensName).check();
  await expect(dialog.getByText(/Race points: 0 → 35/)).toBeVisible();
  await expect(dialog.locator('p').filter({ hasText: /^Owl form ·/ })).toBeVisible();
  await dialog.getByLabel('Current form').selectOption('');
  await expect(
    dialog.locator('p').filter({ hasText: new RegExp(`^${variantName} ·`) }),
  ).toBeVisible();
  await expect(dialog.getByText('Forest Lore')).toBeVisible();

  for (const width of widths) {
    await test.step(`race dialog fits ${width}px`, async () => {
      await page.setViewportSize({ width, height: width < 400 ? 740 : 800 });
      const box = await geometry(dialog.locator('.modal-box'));
      expect(box.x, `dialog starts inside ${width}px viewport`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `dialog ends inside ${width}px viewport`).toBeLessThanOrEqual(
        width + 1,
      );
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual((width < 400 ? 740 : 800) + 1);
      await expect(raceSelect).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Apply race' })).toBeVisible();
      if ([320, 640, 768, 1280].includes(width)) {
        await captureReviewScreenshot(page, {
          path: testInfo.outputPath(`race-choice-${width}.png`),
          animations: 'disabled',
        });
      }
    });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  const modalBox = dialog.locator('.modal-box');
  const modalScroll = await modalBox.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(modalScroll.scrollHeight).toBeGreaterThan(modalScroll.clientHeight);
  const applyRace = dialog.getByRole('button', { name: 'Apply race' });
  await applyRace.scrollIntoViewIfNeeded();
  const applyBox = await geometry(applyRace);
  expect(applyBox.x).toBeGreaterThanOrEqual(0);
  expect(applyBox.x + applyBox.width).toBeLessThanOrEqual(321);
  expect(applyBox.y).toBeGreaterThanOrEqual(0);
  expect(applyBox.y + applyBox.height).toBeLessThanOrEqual(741);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('race-choice-320-apply.png'),
    animations: 'disabled',
  });
  await modalBox.evaluate((element) => {
    element.scrollTop = 0;
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(raceButton).toBeVisible();
  await expect(raceButton).toContainText('Human');

  await raceButton.click();
  await raceSelect.selectOption(raceId);
  await dialog.getByLabel('Variant').selectOption('northwood');
  await dialog.getByLabel(lensName).check();
  await dialog.getByRole('button', { name: 'Apply race' }).click();
  const ownedRaceName = `${variantName} · ${lensName}`;
  await expect(
    page.getByRole('button', { name: `Change race: ${ownedRaceName}`, exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  });
  const strengthBase = page.getByLabel('ST base');
  await expect(strengthBase).toHaveValue('10');
  const strengthBreakdown = strengthBase.locator('xpath=../..');
  await expect(strengthBreakdown.getByText('11', { exact: true })).toBeVisible();
  await expect(strengthBreakdown.getByText('+1', { exact: true })).toBeVisible();
  await selectCharacterSection(page, 'Skills');
  const racialSkill = page.getByRole('row', { name: /Forest Lore/ });
  await expect(racialSkill).toBeVisible();
  await expect(racialSkill.getByText('2 race', { exact: true })).toBeVisible();
  await racialSkill.getByRole('button', { name: 'View Forest Lore' }).click();
  await expect(
    page.getByText('Included in your race. Change this purchase through Race in Overview.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Forest Lore' })).toHaveCount(0);
  await selectCharacterSection(page, 'Overview');
  await ledger.click();
  await expect(raceLedgerRow).toContainText('35');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await raceLedgerRow.scrollIntoViewIfNeeded();
    const box = await geometry(raceLedgerRow);
    expect(box.x, `race ledger starts inside ${width}px viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `race ledger ends inside ${width}px viewport`).toBeLessThanOrEqual(
      width + 1,
    );
  }
  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('race-overview-desktop.png'),
    animations: 'disabled',
  });

  await page.goto(`/campaigns/${campaign.id}/library?section=races`);
  const deleteButton = page.getByRole('button', { name: `Delete ${revisedName}` });
  await deleteButton.click();
  await expect(page.getByRole('dialog', { name: 'Delete library race' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Delete library race' })
    .getByRole('button', { name: /delete/i })
    .click();
  await expect(page.getByRole('button', { name: revisedName, exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
});
