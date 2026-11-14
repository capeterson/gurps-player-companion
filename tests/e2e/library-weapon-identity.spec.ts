import { expect } from '@playwright/test';
import { test } from './authenticated-fixture';

test('weapon mode identity survives renaming, duplication, reorder and reopening', async ({
  page,
}) => {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { authorization: `Bearer ${token}` };
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    headers,
    data: { name: 'Weapon identity campaign' },
  });
  expect(campaignResponse.ok()).toBeTruthy();
  const campaign = (await campaignResponse.json()) as { id: string };
  const itemResponse = await page.request.post(`/api/v1/campaigns/${campaign.id}/library/items`, {
    headers,
    data: {
      name: 'Identity sword',
      cost: 10,
      weightLbs: 2,
      weaponData: { modes: [{ key: 'linked-swing', name: 'Swing', damage: 'sw cut' }] },
    },
  });
  expect(itemResponse.ok(), await itemResponse.text()).toBeTruthy();
  await page.goto(`/campaigns/${campaign.id}/library?section=items`);
  await page.getByRole('button', { name: 'Edit Identity sword' }).click();
  await page.locator('summary').filter({ hasText: 'Equipment facets' }).click();
  await page.getByLabel('Attack name, Swing').fill('Cut');
  await page.getByRole('button', { name: 'Duplicate attack Cut', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate attack Cut', exact: true }).click();
  await page.getByRole('button', { name: 'Move attack Cut down' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/campaigns/${campaign.id}/library`, {
          headers,
        });
        const result = (await response.json()) as {
          items: Array<{
            name: string;
            weaponData?: { modes: Array<{ key: string; name: string }> };
          }>;
        };
        return result.items
          .find((item) => item.name === 'Identity sword')
          ?.weaponData?.modes.map(({ key, name }) => ({ key, name }));
      },
      { timeout: 20_000 },
    )
    .toEqual([
      { key: 'cut-copy-2', name: 'Cut copy' },
      { key: 'linked-swing', name: 'Cut' },
      { key: 'cut-copy', name: 'Cut copy' },
    ]);
  await page.reload();
  await page.getByRole('button', { name: 'Edit Identity sword' }).click();
  await page.locator('summary').filter({ hasText: 'Equipment facets' }).click();
  await expect(page.getByLabel('Attack name, Cut', { exact: true })).toHaveValue('Cut');
  await expect(page.getByLabel('Attack name, Cut copy', { exact: true })).toHaveCount(2);
});
