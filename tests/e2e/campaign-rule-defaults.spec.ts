import { expect } from '@playwright/test';
import { Pool } from 'pg';
import { test } from './authenticated-fixture';
import { selectCharacterSection } from './character-navigation';

test('a sparse campaign default permits a linked skill and later rule changes affect it', async ({
  page,
}) => {
  test.skip(!process.env.ADMIN_E2E_DATABASE_URL, 'Requires this worktree test database');
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { Authorization: `Bearer ${token}` };
  const create = async (path: string, data: unknown) => {
    const response = await page.request.post(`/api/v1${path}`, { headers, data });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  };
  const campaign = await create('/campaigns', { name: 'Sparse campaign' });
  const character = await create('/characters', { name: 'Rule learner', campaignId: campaign.id });
  await create(`/campaigns/${campaign.id}/library/skills`, {
    name: 'Acid-free study',
    attribute: 'IQ',
    difficulty: 'A',
    prerequisiteRules: { kind: 'campaign_rule', ruleKey: 'forbidAcidMagic', expectedValue: false },
  });
  const pool = new Pool({ connectionString: process.env.ADMIN_E2E_DATABASE_URL });
  try {
    await pool.query('UPDATE campaigns SET house_rules = $1 WHERE id = $2', [
      JSON.stringify({ ruleSet: 'custom' }),
      campaign.id,
    ]);
  } finally {
    await pool.end();
  }
  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Skills');
  await page.getByRole('button', { name: '+ Add skill' }).click();
  await page.getByRole('textbox', { name: 'Skill', exact: true }).fill('Acid-free study');
  await page.getByRole('option', { name: /Acid-free study/ }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/characters/${character.id}`, { headers });
      const detail = await response.json();
      return detail.skills.find((skill: { name: string }) => skill.name === 'Acid-free study')
        ?.prerequisiteStatus;
    })
    .toBe('met');
  await expect(page.getByText(/Unmet:|Check prerequisites/)).toHaveCount(0);
  const changed = await page.request.patch(`/api/v1/campaigns/${campaign.id}`, {
    headers,
    data: { houseRules: { ruleSet: 'custom', forbidAcidMagic: true } },
  });
  expect(changed.status()).toBe(200);
  await expect
    .poll(async () => {
      const detail = await (
        await page.request.get(`/api/v1/characters/${character.id}`, { headers })
      ).json();
      return detail.skills[0]?.prerequisiteStatus;
    })
    .toBe('unmet');
  await page.reload();
  await selectCharacterSection(page, 'Skills');
  await expect(page.getByText(/Unmet:/)).toBeVisible();
});
