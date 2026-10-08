import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

async function openFixture(page: Page, email: string, name: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const roster = await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken;
    const response = await fetch('/api/v1/characters', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Roster: ${response.status}`);
    return response.json() as Promise<{ id: string; name: string }[]>;
  });
  const character = roster.find((row) => row.name === name);
  expect(character, `Missing seeded ${name}`).toBeDefined();
  await page.goto(`/characters/${character?.id}`);
  await selectCharacterSection(page, 'Combat');
  const pane = page.getByRole('region', { name: 'Incoming attack' });
  await expect(pane).toBeVisible();
  await pane.getByRole('combobox', { name: 'Hit location', exact: true }).scrollIntoViewIfNeeded();
  return pane;
}

async function preview(page: Page, pane: Locator, basic: number, text: string) {
  await pane.getByRole('button', { name: 'Incoming damage…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Incoming damage' });
  await dialog.getByLabel('Basic damage').fill(String(basic));
  await expect(dialog.getByText(text, { exact: true })).toBeVisible();
  await dialog.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const box = await dialog.locator('.modal-box').boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  return dialog;
}

test('Kestrel layered armor produces cutting, crushing and extremity damage previews', async ({
  page,
}, testInfo) => {
  const pane = await openFixture(page, 'rowan@example.invalid', 'Kestrel Vale');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await pane.getByRole('combobox', { name: 'Hit location', exact: true }).selectOption('torso');
    await pane.getByLabel('Armor facing').selectOption('front');
    await pane.getByRole('combobox', { name: 'Damage type', exact: true }).selectOption('cut');
    await pane.getByRole('combobox', { name: 'Armor penetration', exact: true }).selectOption('');
    const layers = pane.getByRole('list', { name: 'Protection layers' });
    await expect(layers.getByRole('link', { name: 'Tidewire coat', exact: true })).toBeVisible();
    await expect(
      layers.getByRole('link', { name: 'Shoalwatch brigandine', exact: true }),
    ).toBeVisible();
    let dialog = await preview(page, pane, 10, '10 cut − DR 8 → 2 × 1.5 = 3 injury');
    await attachReviewScreenshot(page, testInfo, `kestrel-layered-cut-${width}`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await pane.getByRole('combobox', { name: 'Damage type', exact: true }).selectOption('cr');
    dialog = await preview(page, pane, 10, '10 cr − DR 4 → 6 × 1 = 6 injury');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await pane
      .getByRole('combobox', { name: 'Hit location', exact: true })
      .selectOption('hand_left');
    await pane.getByRole('combobox', { name: 'Damage type', exact: true }).selectOption('imp');
    await pane.getByRole('combobox', { name: 'Armor penetration', exact: true }).selectOption('2');
    dialog = await preview(
      page,
      pane,
      12,
      '12 imp − DR 2/2=1 → 11 × 1 = 11 injury; capped at 5 HP loss',
    );
    await expect(dialog.getByText(/the body part is destroyed/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
});

test('Bram directional plates feed distinct vitals and torso damage previews', async ({
  page,
}, testInfo) => {
  const pane = await openFixture(page, 'bram@example.invalid', 'Bram Stonebridge');
  await pane.getByRole('combobox', { name: 'Damage type', exact: true }).selectOption('imp');
  await pane.getByRole('combobox', { name: 'Hit location', exact: true }).selectOption('vitals');
  await pane.getByRole('combobox', { name: 'Armor penetration', exact: true }).selectOption('2');
  let dialog = await preview(page, pane, 12, '12 imp − DR 10/2=5 → 7 × 3 = 21 injury');
  await attachReviewScreenshot(page, testInfo, 'bram-vitals');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await pane.getByRole('combobox', { name: 'Hit location', exact: true }).selectOption('torso');
  await pane.getByRole('combobox', { name: 'Armor penetration', exact: true }).selectOption('');
  await pane.getByLabel('Armor facing').selectOption('back');
  dialog = await preview(page, pane, 12, '12 imp − DR 8 → 4 × 2 = 8 injury');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await pane.getByLabel('Armor facing').selectOption('left');
  dialog = await preview(page, pane, 12, '12 imp − DR 5 → 7 × 2 = 14 injury');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('Sable burning protection uses only the winning armor enchantment', async ({
  page,
}, testInfo) => {
  const pane = await openFixture(page, 'sable@example.invalid', 'Sable Fenwick');
  await pane.getByRole('combobox', { name: 'Damage type', exact: true }).selectOption('burn');
  const layers = pane.getByRole('list', { name: 'Protection layers' });
  await expect(layers).toContainText('suppressed');
  const dialog = await preview(page, pane, 10, '10 burn − DR 6 → 4 × 1 = 4 injury');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await attachReviewScreenshot(page, testInfo, 'sable-protection-layers');
});
