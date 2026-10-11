import { expect, test } from './authenticated-fixture';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

test('B269 campaign controls, combat preview and actual rolls agree without changing the weapon', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { Authorization: `Bearer ${token}` };
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    headers,
    data: {
      name: 'Damage conversion',
      houseRules: { ruleSet: 'j_talisar' },
    },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaign = await campaignResponse.json();
  const characterResponse = await page.request.post('/api/v1/characters', {
    headers,
    data: {
      name: 'Raphaël',
      st: 15,
      campaignId: campaign.id,
    },
  });
  expect(characterResponse.status()).toBe(201);
  const character = await characterResponse.json();
  const weaponResponse = await page.request.post(`/api/v1/characters/${character.id}/inventory`, {
    headers,
    data: {
      name: 'Pride’s Remedy',
      equipped: true,
      enchantments: [{ spellName: 'Puissance', notes: 'Recorded enchantment; no synthetic bonus' }],
      weaponData: { damage: 'sw+4 cut', skill: 'Broadsword' },
    },
  });
  expect(weaponResponse.status()).toBe(201);
  const originalWeapon = await weaponResponse.json();

  await page.goto(`/campaigns/${campaign.id}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Damage conversion' });
  await settings.getByRole('button', { name: 'Rules', exact: true }).click();
  const control = settings.getByRole('checkbox', { name: /Convert damage adds to dice/ });
  await expect(control).toBeChecked();
  await expect(settings.getByText(/This changes the roll distribution/)).toBeVisible();
  await attachReviewScreenshot(page, testInfo, 'damage-conversion-setting');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Reuse one actor/page across toggles; each visit waits for the synced setting.
  for (const enabled of [true, false, true]) {
    if (!enabled) {
      await page.goto(`/campaigns/${campaign.id}`);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await settings.getByRole('button', { name: 'Rules', exact: true }).click();
      await settings.getByLabel('House rule set').selectOption('custom');
      await control.uncheck();
      await settings.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(settings).not.toBeVisible();
    } else {
      const response = await page.request.patch(`/api/v1/campaigns/${campaign.id}`, {
        headers,
        data: {
          houseRules: { ruleSet: 'j_talisar', convertDamageAddsToDice: true },
        },
      });
      expect(response.status()).toBe(200);
    }
    await page.goto(`/characters/${character.id}`);
    await selectCharacterSection(page, 'Combat');
    const formula = enabled ? '3d+1' : '2d+5';
    const chip = page.getByRole('button', { name: `${formula} cut`, exact: true });
    await expect(chip).toBeVisible();
    await chip.click();
    const roll = page.getByRole('dialog', { name: /Roll Pride’s Remedy damage/ });
    await expect(roll.getByLabel(`Damage formula ${formula} cut`, { exact: true })).toBeVisible();
    await roll.getByRole('button', { name: `Roll ${formula}`, exact: true }).click();
    const result = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`gurps:rollHistory:${id}`) ?? '[]')[0],
      character.id,
    );
    expect(result.dice).toHaveLength(enabled ? 3 : 2);
    expect(result.total).toBe(
      result.dice.reduce((total: number, die: number) => total + die, enabled ? 1 : 5),
    );
    expect(result.damageType).toBe('cut');
    await attachReviewScreenshot(
      page,
      testInfo,
      enabled ? 'converted-damage-roll' : 'unconverted-damage-roll',
    );
    await roll.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  const saved = await page.request.get(
    `/api/v1/characters/${character.id}/inventory/${originalWeapon.id}`,
    { headers },
  );
  expect(saved.status()).toBe(200);
  const weapon = await saved.json();
  expect(weapon.weaponData).toEqual(originalWeapon.weaponData);
  expect(weapon.enchantments).toEqual(originalWeapon.enchantments);
});
