import { type Locator, type Page, expect } from '@playwright/test';
import { test } from './authenticated-fixture';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

test.use({ serviceWorkers: 'block' });

// Phone (stacked rows), the 640px breakpoint boundaries, and desktop.
const VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 1280, height: 800 },
] as const;

type Item = { id: string; name: string; parentId: string | null; worn: boolean };

async function api(page: Page) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { authorization: `Bearer ${token}` };
  return {
    async post(path: string, data: object) {
      const response = await page.request.post(`/api/v1${path}`, { data, headers });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json() as Promise<{ id: string; item?: { id: string } }>;
    },
    async inventory(characterId: string) {
      const response = await page.request.get(`/api/v1/characters/${characterId}`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { inventory: Item[] }).inventory;
    },
  };
}

function itemTitle(table: Locator, name: string) {
  return table.locator('.inventory-item-title').getByText(name, { exact: true });
}

test('inventory rows drag between On the player, Stashed and containers', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const client = await api(page);

  for (const viewport of VIEWPORTS) {
    await test.step(`drag and drop at ${viewport.width}px`, async () => {
      await page.setViewportSize(viewport);
      const characterId = (
        await client.post('/characters', { name: `Drag mover ${viewport.width}` })
      ).id;
      const inventory = `/characters/${characterId}/inventory`;
      const pack = (
        await client.post(inventory, { name: 'Backpack', isContainer: true, worn: true })
      ).item?.id;
      await client.post(inventory, { name: 'Belt pouch', isContainer: true, parentId: pack });
      await client.post(inventory, { name: 'Bedroll', worn: true });
      await client.post(inventory, { name: 'Trail rations', worn: true });
      await client.post(inventory, { name: 'Spare rope', worn: false });
      await client.post(inventory, { name: 'Spare lantern', worn: false });

      await page.goto(`/characters/${characterId}`);
      await expectCharacterNavigationReady(page);
      await selectCharacterSection(page, 'Inventory');
      const carried = page.getByRole('table', { name: 'Carried inventory', exact: true });
      const stashed = page.getByRole('table', { name: 'Stashed inventory', exact: true });
      await expect(itemTitle(carried, 'Bedroll')).toBeVisible();

      // Dropping over an ordinary row in the other list moves the item there.
      await itemTitle(carried, 'Bedroll').dragTo(itemTitle(stashed, 'Spare rope'));
      await expect(itemTitle(stashed, 'Bedroll')).toBeVisible();
      await expect(itemTitle(carried, 'Bedroll')).toHaveCount(0);

      await itemTitle(stashed, 'Spare lantern').dragTo(itemTitle(carried, 'Trail rations'));
      await expect(itemTitle(carried, 'Spare lantern')).toBeVisible();
      await expect(itemTitle(stashed, 'Spare lantern')).toHaveCount(0);

      // Dropping on a container row nests the item inside it.
      await itemTitle(stashed, 'Spare rope').dragTo(itemTitle(carried, 'Backpack'));
      await expect(itemTitle(stashed, 'Spare rope')).toHaveCount(0);
      const packRow = carried.getByRole('row').filter({
        has: page.locator('.inventory-item-title').getByText('Backpack', { exact: true }),
      });
      await expect(packRow.getByLabel('2 contained items')).toBeVisible();
      await packRow.getByRole('button', { name: 'Expand contents' }).click();
      await expect(itemTitle(carried, 'Spare rope')).toBeVisible();
      await expect(itemTitle(carried, 'Belt pouch')).toBeVisible();

      // A container can't move into its own contents; it stays where it was.
      await itemTitle(carried, 'Backpack').dragTo(itemTitle(carried, 'Belt pouch'));
      await expect(itemTitle(carried, 'Backpack')).toBeVisible();
      await expect(itemTitle(carried, 'Belt pouch')).toBeVisible();
      await expect(packRow.getByRole('button', { name: 'Collapse contents' })).toBeVisible();

      await attachReviewScreenshot(page, testInfo, `inventory-drag-drop-${viewport.width}`, {
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );

      await expect
        .poll(async () => {
          const items = await client.inventory(characterId);
          const where = (name: string) => {
            const item = items.find((i) => i.name === name);
            if (!item) return 'missing';
            if (item.parentId) return `in ${items.find((i) => i.id === item.parentId)?.name}`;
            return item.worn ? 'on the player' : 'stashed';
          };
          return ['Bedroll', 'Spare lantern', 'Spare rope', 'Belt pouch', 'Backpack'].map(
            (name) => `${name}: ${where(name)}`,
          );
        })
        .toEqual([
          'Bedroll: stashed',
          'Spare lantern: on the player',
          'Spare rope: in Backpack',
          'Belt pouch: in Backpack',
          'Backpack: on the player',
        ]);
    });
  }
});
