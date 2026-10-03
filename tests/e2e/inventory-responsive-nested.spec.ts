import { type Locator, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

const PASSWORD = 'CorrectHorseBatteryStaple1';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const PACK_NAME = 'UnbrokenTrailPackName'.repeat(4);
const POUCH_NAME = 'UnbrokenInnerPouchName'.repeat(3);
const CASE_NAME = 'UnbrokenSmallCaseName'.repeat(3);
const ITEM_NAME = 'UnbrokenInventoryItemName'.repeat(4);

async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      right: rect.right,
      width: rect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      height: rect.height,
    };
  });
}

test('nested inventory names and expanded item controls stay in view at supported widths', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `inventory-responsive-${runId}@example.com`;
  const campaignName = `Inventory responsive ${runId}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });
  let campaignId: string | undefined;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Inventory Layout QA');
    await page.getByLabel(/^password\b/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    async function create<T>(path: string, data: object): Promise<T> {
      const response = await page.request.post(`/api/v1${path}`, {
        data,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
      return response.json() as Promise<T>;
    }

    const campaign = await create<{ id: string }>('/campaigns', { name: campaignName });
    campaignId = campaign.id;
    const character = await create<{ id: string }>('/characters', {
      name: 'Responsive inventory character',
      campaignId: campaign.id,
    });
    const characterPath = `/characters/${character.id}`;
    const pack = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: PACK_NAME,
      worn: true,
      isContainer: true,
      weightLbs: 1,
      cost: 10,
    });
    const pouch = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: POUCH_NAME,
      parentId: pack.item.id,
      isContainer: true,
      weightLbs: 0.5,
      cost: 5,
    });
    const caseItem = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: CASE_NAME,
      parentId: pouch.item.id,
      isContainer: true,
      weightLbs: 0.2,
      cost: 2,
    });
    const item = await create<{ item: { id: string } }>(`${characterPath}/inventory`, {
      name: ITEM_NAME,
      parentId: caseItem.item.id,
      weightLbs: 0.1,
      cost: 1,
      notes: 'A nested item with a visible details editor.',
    });

    await page.goto(characterPath);
    await selectCharacterSection(page, 'Inventory');
    const inventory = page.getByRole('table', { name: 'Carried inventory', exact: true });
    await expect(page.getByText('Worn', { exact: true })).toHaveCount(0);
    const location = page.getByLabel('Location');
    await expect(location).toHaveValue('');
    await expect(location.locator('option', { hasText: 'On the player' })).toHaveAttribute(
      'value',
      '',
    );
    await expect(location.locator('option', { hasText: 'Stashed' })).toHaveAttribute(
      'value',
      'stashed',
    );
    const rows = [pack, pouch, caseItem, item].map(({ item: row }) =>
      page.locator(`#inventory-${row.id}`),
    );
    for (const index of [0, 1, 2]) {
      await rows[index].getByRole('button', { name: 'Expand contents' }).click();
    }
    const titles = rows.map((row) => row.locator('.inventory-item-title'));
    const containerSettings = [PACK_NAME, POUCH_NAME, CASE_NAME].map((name, index) =>
      rows[index].getByRole('button', { name: `Container settings for ${name}`, exact: true }),
    );
    for (let index = 0; index < titles.length; index += 1) {
      await expect(titles[index]).toHaveText([PACK_NAME, POUCH_NAME, CASE_NAME, ITEM_NAME][index]);
    }
    for (const settingsButton of containerSettings) await expect(settingsButton).toBeVisible();
    await rows[3].getByRole('button', { name: `Edit ${ITEM_NAME}` }).click();
    const editor = page.getByRole('region', { name: `${ITEM_NAME}: Item details`, exact: true });
    const nameInput = editor.getByLabel('Name', { exact: true });
    const doneButton = editor.getByRole('button', { name: 'Done', exact: true });
    await expect(editor).toBeVisible();
    await expect(nameInput).toHaveValue(ITEM_NAME);
    await expect(doneButton).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await inventory.scrollIntoViewIfNeeded();
        await expect(editor).toBeVisible();
        await expect(nameInput).toBeVisible();
        await expect(doneButton).toBeVisible();
        const visibleRows = [rows[0], rows[1], rows[2], rows[3], editor, nameInput, doneButton];
        for (let index = 0; index < visibleRows.length; index += 1) {
          const box = await geometry(visibleRows[index]);
          expect(
            box.x,
            `content ${index} begins inside viewport at ${viewport.width}`,
          ).toBeGreaterThanOrEqual(-1);
          expect(
            box.right,
            `content ${index} ends inside viewport at ${viewport.width}`,
          ).toBeLessThanOrEqual(viewport.width + 1);
          if (index >= 4) expect(box.width).toBeGreaterThan(0);
        }
        for (const title of titles) {
          const metrics = await geometry(title);
          expect(metrics.scrollWidth, `item name wraps at ${viewport.width}`).toBeLessThanOrEqual(
            metrics.clientWidth + 1,
          );
        }
        for (const settingsButton of containerSettings) {
          const chipBox = await geometry(settingsButton);
          expect(chipBox.x).toBeGreaterThanOrEqual(-1);
          expect(chipBox.right).toBeLessThanOrEqual(viewport.width + 1);
          expect(
            chipBox.height,
            `container label stays legible at ${viewport.width}`,
          ).toBeLessThanOrEqual(48);
          await expect(settingsButton).toContainText('Container');
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);
        if ([320, 568, 640, 768, 1024, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `inventory-nested-${viewport.width}x${viewport.height}`,
            { fullPage: true, animations: 'disabled' },
          );
        }
      });
    }

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const stashedName = `Stashed item ${runId}`;
    await page.getByLabel('Item name').fill(stashedName);
    await location.selectOption('stashed');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const stashedInventory = page.getByRole('table', { name: 'Stashed inventory', exact: true });
    await expect(stashedInventory).toContainText(stashedName, { timeout: 15_000 });
    await expect(inventory).not.toContainText(stashedName);

    const createdName = `Carried and equipped ${runId}`;
    const addForm = location.locator('xpath=ancestor::form');
    await addForm.getByLabel('Item name').fill(createdName);
    await expect(location).toHaveValue('');
    await addForm.getByRole('button', { name: 'More options' }).click();
    const equipped = addForm.getByLabel('Equipped', { exact: true });
    await equipped.check();
    await addForm.getByRole('button', { name: 'Add', exact: true }).click();
    const createdRow = inventory.getByRole('row').filter({ hasText: createdName });
    await expect(createdRow).toBeVisible({ timeout: 15_000 });
    await expect(inventory).toContainText(createdName);
    await expect(stashedInventory).not.toContainText(createdName);
    await expect(page.getByText('Worn', { exact: true })).toHaveCount(0);
    await createdRow.locator('.inventory-item-title').click();
    await expect(page.getByText('1 selected')).toBeVisible();

    const moveDropdown = page.getByRole('button', { name: 'Move to ▾' }).locator('xpath=..');
    const moveMenu = moveDropdown.locator('ul.dropdown-content');
    for (const viewport of VIEWPORTS) {
      await test.step(`Move menu at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await moveDropdown.getByRole('button', { name: 'Move to ▾' }).click();
        await expect(moveMenu).toBeVisible();
        await moveMenu.evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(moveMenu.getByRole('button', { name: 'On the player' })).toBeVisible();
        const longContainerOption = moveMenu.getByRole('button', {
          name: PACK_NAME,
          exact: true,
        });
        await longContainerOption.scrollIntoViewIfNeeded();
        await expect(longContainerOption).toBeVisible();
        const box = await geometry(moveMenu);
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.height).toBeGreaterThan(0);
        const optionBox = await geometry(longContainerOption);
        expect(optionBox.x).toBeGreaterThanOrEqual(-1);
        expect(optionBox.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(optionBox.scrollWidth).toBeLessThanOrEqual(optionBox.clientWidth + 1);
        const vertical = await moveMenu.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        });
        const banner = await page.getByRole('banner').boundingBox();
        expect(banner).not.toBeNull();
        expect(vertical.top).toBeGreaterThanOrEqual((banner?.y ?? 0) + (banner?.height ?? 0) - 1);
        expect(vertical.bottom).toBeLessThanOrEqual(viewport.height + 1);
        if ([320, 568, 639, 640, 641, 768, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `inventory-move-menu-${viewport.width}x${viewport.height}`,
            { fullPage: true, animations: 'disabled' },
          );
        }
        await page.mouse.click(2, viewport.height / 2);
        await expect(moveMenu).not.toBeVisible();
      });
    }
  } finally {
    try {
      if (campaignId) {
        const token = await page
          .evaluate(
            () =>
              JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
          )
          .catch(() => undefined);
        if (token) {
          await page.request.delete(`/api/v1/campaigns/${campaignId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      await pool.query(
        'delete from campaigns where name=$1 and owner_id=(select id from users where email=$2)',
        [campaignName, email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
