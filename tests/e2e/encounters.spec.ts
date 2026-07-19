/**
 * Encounter tracker happy paths against the running Docker stack.
 *
 * The GM flows use the browser UI. Timed-effect controls are not currently
 * rendered by the encounter page, so that lifecycle uses its REST endpoints.
 */

import { expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const password = 'CorrectHorseBatteryStaple1';

async function register(page: import('@playwright/test').Page, email: string, name: string) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill(name);
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
}

async function createCampaign(page: import('@playwright/test').Page, name: string) {
  await page.goto('/campaigns');
  await page.getByRole('button', { name: /new campaign/i }).click();
  await page.getByLabel(/campaign name/i).fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  const campaign = page.getByRole('link', { name: new RegExp(name) });
  await expect(campaign).toBeVisible();
  await campaign.click();
  await expect(page).toHaveURL(/\/campaigns\/[a-f0-9-]+$/, { timeout: 10_000 });
  return page.url().split('/').at(-1) ?? '';
}

async function accessToken(page: import('@playwright/test').Page) {
  return page.evaluate(() => localStorage.getItem('gpc.access'));
}

async function api(
  page: import('@playwright/test').Page,
  path: string,
  options: { method: 'GET' | 'POST' | 'PATCH'; data?: unknown },
) {
  const token = await accessToken(page);
  expect(token).not.toBeNull();
  return page.request.fetch(`/api/v1${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
}

test('GM runs an NPC encounter through expiry acknowledgement and ending', async ({ page }) => {
  const id = suffix();
  await register(page, `e2e-encounter-gm-${id}@example.com`, 'Encounter GM');
  const campaignId = await createCampaign(page, `Encounter ${id}`);

  await page.getByRole('button', { name: /new encounter/i }).click();
  await expect(page).toHaveURL(/\/encounters\/[a-f0-9-]+$/, { timeout: 10_000 });
  const encounterId = page.url().split('/').at(-1) ?? '';
  await expect(page.getByRole('heading', { name: 'Encounter' })).toBeVisible();

  await page.getByRole('button', { name: 'Detailed NPC' }).click();
  const createNpcDialog = page.locator('dialog');
  await createNpcDialog.getByLabel('NPC name').fill('Orc scout');
  await createNpcDialog.getByLabel('Max HP').fill('12');
  await createNpcDialog.getByLabel('Current HP').fill('12');
  await createNpcDialog.getByRole('button', { name: 'Add NPC' }).click();
  const orc = page.locator('article').filter({ hasText: 'Orc scout' });
  await expect(orc).toContainText('HP 12 / 12');

  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(page.getByText(/Round 1 · Orc scout/)).toBeVisible();
  await orc.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.locator('dialog');
  await editor.getByLabel('Current HP').fill('11');
  await editor.getByRole('button', { name: 'Save NPC' }).click();
  await expect(orc).toContainText('HP 11 / 12');

  const state = await api(page, `/campaigns/${campaignId}/encounters/${encounterId}`, {
    method: 'GET',
  });
  expect(state.status()).toBe(200);
  const encounter = (await state.json()) as { combatants: { id: string; name: string }[] };
  const orcId = encounter.combatants.find((combatant) => combatant.name === 'Orc scout')?.id;
  if (!orcId) throw new Error('Orc scout was not returned by the encounter API');
  const effect = await api(page, `/campaigns/${campaignId}/encounters/${encounterId}/effects`, {
    method: 'POST',
    data: {
      targetCombatantId: orcId,
      name: 'Stun',
      duration: { unit: 'rounds', amount: 1 },
    },
  });
  expect(effect.status()).toBe(201);
  const createdEffect = (await effect.json()) as { id: string; startedAtRound: number };
  expect(createdEffect.startedAtRound).toBe(1);

  // The direct API setup changed the encounter version, so refresh before
  // submitting the UI's optimistic-concurrency turn advance.
  await page.reload();
  await expect(page.getByText('Stun', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next turn' }).click();
  await expect(page.getByText(/Round 2 · Orc scout/)).toBeVisible();
  const acknowledgement = await api(
    page,
    `/campaigns/${campaignId}/encounters/${encounterId}/effects/${createdEffect.id}`,
    { method: 'PATCH', data: { expiryAcknowledgedAtRound: 2 } },
  );
  expect(acknowledgement.status()).toBe(200);
  await expect(acknowledgement.json()).resolves.toMatchObject({ expiryAcknowledgedAtRound: 2 });

  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'End combat' }).click();
  await expect(page.getByText('Combat ended', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End combat' })).toHaveCount(0);
});

test('player encounter view omits a hidden NPC', async ({ browser }) => {
  const id = suffix();
  const gmContext = await browser.newContext();
  const gm = await gmContext.newPage();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const playerEmail = `e2e-encounter-player-${id}@example.com`;

  await register(gm, `e2e-encounter-hidden-gm-${id}@example.com`, 'Hidden NPC GM');
  const campaignId = await createCampaign(gm, `Hidden NPC ${id}`);
  await register(player, playerEmail, 'Encounter Player');

  const addMember = await api(gm, `/campaigns/${campaignId}/members`, {
    method: 'POST',
    data: { email: playerEmail },
  });
  expect(addMember.status()).toBe(200);

  await gm.goto(`/campaigns/${campaignId}`);
  await gm.getByRole('button', { name: /new encounter/i }).click();
  await expect(gm).toHaveURL(/\/encounters\/[a-f0-9-]+$/, { timeout: 10_000 });
  const encounterId = gm.url().split('/').at(-1) ?? '';
  await gm.getByLabel('NPC name').fill('Visible guard');
  await gm.getByRole('button', { name: 'Add NPC' }).click();
  await gm.getByRole('button', { name: 'Detailed NPC' }).click();
  const hiddenNpcDialog = gm.locator('dialog');
  await hiddenNpcDialog.getByLabel('NPC name').fill('Hidden assassin');
  await hiddenNpcDialog.getByLabel('Hidden from players').check();
  await hiddenNpcDialog.getByRole('button', { name: 'Add NPC' }).click();

  await player.goto(`/campaigns/${campaignId}/encounters/${encounterId}`);
  await expect(player.getByText('Player view')).toBeVisible();
  await expect(player.getByText('Visible guard', { exact: true })).toBeVisible();
  await expect(player.getByText('Hidden assassin', { exact: true })).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Next turn' })).toHaveCount(0);

  await gmContext.close();
  await playerContext.close();
});
