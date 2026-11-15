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
  const raceNameField = page.locator('[data-field-path="name"]');
  await raceNameField.fill(raceName);
  await page
    .locator('summary')
    .filter({ hasText: /^Racial profile and options/ })
    .click();
  await page.locator('[data-field-path="points"]').fill('25');
  await page.getByRole('button', { name: 'Add specific traits', exact: true }).click();
  const racialTrait = page.getByRole('group', { name: 'Specific traits 1' });
  await racialTrait.locator('[data-field-path="traits.0.name"]').fill('Acute Vision');
  await racialTrait.locator('[data-field-path="traits.0.points"]').fill('2');
  await racialTrait.getByText('Repair reference key').click();
  await racialTrait.locator('[data-field-path="traits.0.key"]').fill('acute-vision');
  await page.getByRole('button', { name: 'Add variants', exact: true }).click();
  const variantGroup = page.getByRole('group', { name: 'Variants 1' });
  await variantGroup.locator('[data-field-path="variants.0.name"]').fill(variantName);
  await variantGroup.getByText('Repair reference key').first().click();
  await variantGroup.locator('[data-field-path="variants.0.key"]').fill('northwood');
  await variantGroup.locator('[data-field-path="variants.0.points"]').fill('30');
  await variantGroup.getByLabel('Attribute adjustments setting').selectOption('value');
  await variantGroup.getByLabel('ST setting').selectOption('value');
  await variantGroup.locator('[data-field-path="variants.0.attributeModifiers.st"]').fill('1');
  await variantGroup.getByRole('button', { name: 'Add features', exact: true }).click();
  await variantGroup
    .locator('[data-field-path="variants.0.features.0"]')
    .fill(
      'A ceremonial forest tradition described with enough synthetic detail to confirm preview text wraps cleanly on a phone.',
    );
  await variantGroup.getByRole('button', { name: 'Add skills', exact: true }).click();
  const racialSkillFields = variantGroup.getByRole('group', { name: 'Skills 1' });
  await racialSkillFields
    .locator('[data-field-path="variants.0.skills.0.name"]')
    .fill('Forest Lore');
  await racialSkillFields.getByText('Repair reference key').click();
  await racialSkillFields
    .locator('[data-field-path="variants.0.skills.0.key"]')
    .fill('forest-lore');
  await racialSkillFields.locator('[data-field-path="variants.0.skills.0.points"]').fill('2');
  await racialSkillFields.getByLabel('Attribute setting').selectOption('value');
  await racialSkillFields.getByLabel('Difficulty setting').selectOption('value');
  await racialSkillFields
    .locator('[data-field-path="variants.0.skills.0.attribute"]')
    .selectOption('IQ');
  await racialSkillFields
    .locator('[data-field-path="variants.0.skills.0.difficulty"]')
    .selectOption('A');
  await page.getByRole('button', { name: 'Add forms', exact: true }).click();
  const formGroup = page.getByRole('group', { name: 'Forms 1' });
  await formGroup.locator('[data-field-path="forms.0.name"]').fill('Owl form');
  await formGroup.getByText('Repair reference key').first().click();
  await formGroup.locator('[data-field-path="forms.0.key"]').fill('owl-form');
  await formGroup.getByLabel('Attribute adjustments setting').selectOption('value');
  await formGroup.getByLabel('ST setting').selectOption('value');
  await formGroup.locator('[data-field-path="forms.0.attributeModifiers.st"]').fill('2');
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
  await page.locator('[data-field-path="name"]').fill(lensName);
  await page.getByLabel('Kind setting').selectOption('value');
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('lens');
  await page
    .locator('summary')
    .filter({ hasText: /^Racial profile and options/ })
    .click();
  await page.locator('[data-field-path="points"]').fill('5');
  await page.getByRole('button', { name: 'Add race', exact: true }).click();
  await expect(page.getByRole('button', { name: lensName, exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const editRace = page.getByRole('button', { name: `Edit ${raceName}` });
  await editRace.click();
  await page.locator('[data-field-path="name"]').fill(`${raceName} revised`);
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
  const ledger = page.getByRole('button', { name: /\d+ pts$/ });
  await ledger.hover();
  const raceLedgerRow = page
    .locator('li')
    .filter({ has: page.getByText('Race', { exact: true }) })
    .first();
  await expect(raceLedgerRow).toContainText('0');
  await page.mouse.move(0, 0);
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
  await ledger.focus();
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

test('race component duplication retains references through save and reopen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`race-identity-${suffix()}@example.com`);
  await page.getByLabel(/display name/i).fill('Race identity QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const campaign = await create<{ id: string }>(page, '/campaigns', {
    name: `Identity ${suffix()}`,
  });
  const character = await create<{ id: string }>(page, '/characters', {
    name: 'Identity character',
    campaignId: campaign.id,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
  });
  const race = await create<{ id: string }>(page, `/campaigns/${campaign.id}/library/races`, {
    name: 'Identity race',
    key: 'identity-race',
    kind: 'race',
    traits: [{ key: 'keen', name: 'Keen', kind: 'advantage', points: 2 }],
    skills: [{ key: 'lore', name: 'Lore', points: 1 }],
    variants: [
      {
        key: 'variant-original',
        name: 'Variant',
        traits: [{ key: 'variant-trait', name: 'Variant trait', points: 1 }],
      },
    ],
    forms: [
      {
        key: 'form-original',
        name: 'Form',
        skills: [{ key: 'form-skill', name: 'Form skill', points: 1 }],
      },
    ],
  });
  await create(page, `/campaigns/${campaign.id}/library/races`, {
    name: 'Identity lens',
    key: 'identity-lens',
    kind: 'lens',
    compatibleRaceKeys: ['identity-race'],
    removesTraits: ['keen', 'sharp'],
    traits: [
      { key: 'keen', name: 'Lens Keen', kind: 'advantage', points: 3 },
      { key: 'sharp', name: 'Lens Sharp', points: 1 },
    ],
  });
  await page.goto(`/campaigns/${campaign.id}/library?section=races`);
  await page.getByRole('button', { name: 'Edit Identity race' }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Racial profile and options/ })
    .click();
  const first = page.getByRole('group', { name: 'Specific traits 1', exact: true }).first();
  await first.getByText('Repair reference key').click();
  await expect(first).toContainText('Identity lens');
  await first.locator('[data-field-path="traits.0.key"]').fill('sharp');
  await expect(first).toContainText('Proposed key is removed by: Identity lens');
  await expect(first).toContainText('Proposed key is also added by: Identity lens');
  await first.locator('[data-field-path="traits.0.key"]').fill('keen');
  await page.getByRole('button', { name: 'Duplicate Skills 1' }).first().click();
  await page.getByRole('button', { name: 'Duplicate Variants 1' }).click();
  await page.getByRole('button', { name: 'Duplicate Forms 1' }).click();
  const variantCopy = page.getByRole('group', { name: 'Variants 2' });
  const formCopy = page.getByRole('group', { name: 'Forms 2' });
  await variantCopy.locator('[data-field-path="variants.1.name"]').fill('Renamed variant copy');
  await formCopy.locator('[data-field-path="forms.1.name"]').fill('Renamed form copy');
  await page.getByRole('button', { name: 'Duplicate Specific traits 1' }).first().click();
  await page.getByRole('button', { name: 'Move Specific traits 2 up' }).first().click();
  const copy = page.getByRole('group', { name: 'Specific traits 1', exact: true }).first();
  await copy.locator('[data-field-path="traits.0.name"]').fill('Renamed copy');
  await copy.getByText('Repair reference key').click();
  await expect(copy.locator('[data-field-path="traits.0.key"]')).toHaveValue('keen-copy');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Identity race' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Identity race' }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Racial profile and options/ })
    .click();
  const reopened = page.getByRole('group', { name: 'Specific traits 1', exact: true }).first();
  await expect(reopened.locator('[data-field-path="traits.0.name"]')).toHaveValue('Renamed copy');
  await reopened.getByText('Repair reference key').click();
  await expect(reopened.locator('[data-field-path="traits.0.key"]')).toHaveValue('keen-copy');
  for (const [group, path, key] of [
    ['Skills 2', 'skills.1.key', 'lore-copy'],
    ['Variants 2', 'variants.1.key', 'variant-copy'],
    ['Forms 2', 'forms.1.key', 'form-copy'],
  ]) {
    const row = page.getByRole('group', { name: group });
    await row.getByText('Repair reference key').first().click();
    await expect(row.locator(`[data-field-path="${path}"]`)).toHaveValue(key);
  }
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Overview');
  await page.getByRole('button', { name: 'Change race: Human' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose race' });
  await dialog.locator('select').first().selectOption(race.id);
  await dialog.getByLabel('Identity lens').check();
  await expect(dialog.getByText('Renamed copy')).toBeVisible();
  await expect(dialog.getByText('Lens Keen')).toBeVisible();
});
