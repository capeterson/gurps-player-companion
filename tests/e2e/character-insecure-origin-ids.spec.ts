import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

const password = 'CorrectHorseBatteryStaple1';

test('character inventory and solo tracker create IDs on an insecure HTTP origin', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`insecure-character-${suffix}@example.com`);
  await page.getByLabel(/display name/i).fill('Insecure origin QA');
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const originState = await page.evaluate(() => ({
    secure: isSecureContext,
    randomUUID: typeof crypto.randomUUID,
  }));
  expect(originState).toEqual({ secure: false, randomUUID: 'undefined' });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const create = async (path: string, data: object) => {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const campaign = (await create('/campaigns', {
    name: `Insecure UUID QA ${suffix}`,
    experimentalTurnTracker: true,
  })) as { id: string };
  const character = (await create('/characters', {
    name: 'Insecure origin hero',
    campaignId: campaign.id,
  })) as { id: string };
  await create(`/characters/${character.id}/inventory`, {
    name: 'Practice sword',
    worn: true,
    equipped: true,
    weaponData: { damage: 'sw cut', skill: 'Broadsword' },
  });

  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Inventory');
  await page.getByRole('button', { name: 'Weapon settings for Practice sword' }).click();
  const weaponEditor = page.getByRole('region', { name: 'Practice sword: Weapon' });
  await weaponEditor.getByRole('button', { name: 'More options' }).click();
  await weaponEditor.getByRole('textbox', { name: 'New attack mode name' }).fill('Thrust');
  await weaponEditor.getByRole('button', { name: 'Add attack mode' }).click();
  await expect(weaponEditor.getByRole('textbox', { name: 'Mode name', exact: true })).toHaveValue(
    'Thrust',
  );

  await selectCharacterSection(page, 'Combat');
  const tracker = page.locator('.fold-section').filter({ hasText: 'Turn tracker' });
  const trackerToggle = tracker.getByRole('button').first();
  if ((await trackerToggle.getAttribute('aria-expanded')) === 'false') {
    await trackerToggle.click();
  }
  await tracker.getByRole('button', { name: 'Start tracker' }).click();
  await tracker.getByLabel('Solo combatant name').fill('Raider');
  await tracker.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(tracker.getByText('Raider', { exact: true })).toBeVisible();
  await tracker.getByLabel('Effect name').fill('Quick ward');
  await tracker.getByRole('button', { name: 'Add effect', exact: true }).click();
  await expect(tracker.getByText('Quick ward', { exact: true })).toBeVisible();
});
