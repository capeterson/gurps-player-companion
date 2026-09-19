import { type Page, expect, test } from '@playwright/test';
async function setup(page: Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`rules-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Rules player');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15000 });
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}
test('campaign effects and skill actions survive offline editing and reconnect', async ({
  page,
  context,
}) => {
  const token = await setup(page);
  async function create(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const campaign = await create('/campaigns', { name: 'Rules campaign' });
  const definition = await create(`/campaigns/${campaign.id}/library/active-effects`, {
    name: 'Battle Potion',
    effects: [{ target: 'st', value: 2 }],
    stacking: { kind: 'additive', key: 'battle' },
    duration: { kind: 'minutes', amount: 10 },
    capabilities: [{ kind: 'sense', key: 'true_sight', label: 'True Sight' }],
  });
  const skill = await create(`/campaigns/${campaign.id}/library/skills`, {
    name: 'Athletics',
    attribute: 'DX',
    difficulty: 'A',
    procedures: {
      modifiers: [
        {
          id: 'water',
          label: 'Underwater penalty',
          when: [
            {
              input: { domain: 'environment', key: 'water', label: 'Underwater' },
              operator: 'equals',
              value: true,
            },
          ],
          value: { kind: 'fixed', value: -3 },
          appliesTo: 'task_roll',
        },
      ],
      actions: [
        {
          id: 'jump',
          label: 'Jump',
          roll: { basis: 'skill' },
          time: { amount: { kind: 'constant', value: 1 }, unit: 'seconds' },
          outcomes: [{ on: 'success', kind: 'distance', text: 'Clear the obstacle' }],
        },
      ],
      benefits: [
        {
          id: 'trained',
          label: 'Trained defense',
          when: { minimumRelativeLevel: 0 },
          effects: [{ target: 'parry', value: 1 }],
        },
      ],
    },
  });
  const character = await create('/characters', { name: 'Offline hero', campaignId: campaign.id });
  await create(`/characters/${character.id}/skills`, {
    name: 'Athletics',
    attribute: 'DX',
    difficulty: 'A',
    points: 2,
    librarySkillId: skill.id,
  });
  await page.goto(`/characters/${character.id}`);
  await expect(page.getByRole('button', { name: 'Custom effect', exact: true })).toBeVisible();
  // The campaign cursor saves the definitions for offline picking.
  await page.getByPlaceholder('Apply campaign effect…').fill('Battle');
  await expect(page.getByRole('option', { name: 'Battle Potion', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('option', { name: 'Battle Potion', exact: true }).click();
  await expect(page.getByLabel('Battle Potion notes')).toBeVisible();
  await page.getByLabel('Battle Potion notes').fill('Used before the battle');
  await page.getByLabel('Battle Potion notes').blur();
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByText('True Sight — Battle Potion', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/characters/${character.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const detail = await response.json();
      return {
        st: detail.derived.effectiveSt,
        notes: detail.activeEffects[0]?.notes,
        definitionId: detail.activeEffects[0]?.definitionId,
      };
    })
    .toEqual({ st: 12, notes: 'Used before the battle', definitionId: definition.id });
  await page.getByRole('button', { name: /^Skills 1$/ }).click();
  await page.getByRole('button', { name: 'Preview Jump', exact: true }).click();
  await expect(page.getByLabel('Effective target 10')).toBeVisible();
  await page.getByLabel('Underwater', { exact: true }).selectOption('true');
  await expect(page.getByLabel('Effective target 7')).toBeVisible();
  await expect(page.getByText('success: Clear the obstacle')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Combat', exact: true }).click();
  await page.getByRole('button', { name: 'Expire', exact: true }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/characters/${character.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await response.json()).derived.effectiveSt;
    })
    .toBe(10);
});
