import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

const PASSWORD = 'change-me-please-this-is-a-seed-account';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function openSeedCharacter(page: Page) {
  const characters = await page.evaluate(async () => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const token = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch('/api/v1/characters', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`Character list returned ${response.status}`);
    return (await response.json()) as Array<{ id: string; name: string }>;
  });
  const character = characters.find((candidate) => candidate.name === 'Kestrel Vale');
  expect(character, 'Kestrel Vale is missing from the seeded character list').toBeDefined();
  const id = character?.id ?? '';
  await page.goto(`/characters/${id}`);
  return id;
}

async function addLongTrait(page: Page, characterId: string, name: string) {
  return page.evaluate(
    async ({ id, traitName }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const token = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      const response = await fetch(`/api/v1/characters/${id}/traits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          kind: 'perk',
          name: traitName,
          points: 1,
          modifiers: [],
          customEffects: [],
        }),
      });
      if (!response.ok) throw new Error(`Trait create returned ${response.status}`);
      return ((await response.json()) as { trait: { id: string } }).trait.id;
    },
    { id: characterId, traitName: name },
  );
}

async function removeLongTrait(page: Page, characterId: string, traitId: string) {
  await page.evaluate(
    async ({ id, ownedTraitId }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const token = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      await fetch(`/api/v1/characters/${id}/traits/${ownedTraitId}`, {
        method: 'DELETE',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    },
    { id: characterId, ownedTraitId: traitId },
  );
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectMarkerInsideHeaderAndClearOfNeighbors(header: Locator, label: string) {
  const marker = header.getByLabel(`${label} filtered`);
  await expect(marker).toBeVisible();
  const headerBox = await header.boundingBox();
  const markerBox = await marker.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(markerBox).not.toBeNull();
  if (!headerBox || !markerBox) return;
  expect(markerBox.x).toBeGreaterThanOrEqual(headerBox.x);
  expect(markerBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width);
  expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);

  for (const neighbor of [
    header.locator('xpath=preceding-sibling::th[1]'),
    header.locator('xpath=following-sibling::th[1]'),
  ]) {
    const sortButton = neighbor.getByRole('button', { name: /^Sort by / });
    if (!(await sortButton.isVisible())) continue;
    const buttonBox = await sortButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    if (!buttonBox) continue;
    const overlaps =
      markerBox.x < buttonBox.x + buttonBox.width &&
      markerBox.x + markerBox.width > buttonBox.x &&
      markerBox.y < buttonBox.y + buttonBox.height &&
      markerBox.y + markerBox.height > buttonBox.y;
    expect(overlaps, `${label} filter marker overlaps an adjacent sort button`).toBe(false);
  }
}

test('column filters stay in the viewport, persist, compose with search and sorting, and clear', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const characterId = await openSeedCharacter(page);
  const longName = `Browser filter value with representative long content ${'and wrapping '.repeat(5)}${Date.now()}`;
  const traitId = await addLongTrait(page, characterId, longName);

  try {
    await page.reload();
    await selectCharacterSection(page, 'Traits');
    const widths = [320, 390, 639, 640, 641, 767, 768, 769, 1280];
    for (const width of widths) {
      const height = width === 320 ? 240 : width < 640 ? 760 : 900;
      await page.setViewportSize({ width, height });
      const table = page.getByRole('table', { name: 'Traits' });
      await expect(table).toBeVisible();
      const header = table.getByRole('columnheader', { name: /Trait/ });
      await header.click({ button: 'right' });
      const dialog = page.getByRole('dialog', { name: 'Filter Trait' });
      await expectInsideViewport(page, dialog);
      await dialog.getByLabel('Search Trait values').fill(longName);
      await expect(dialog.getByText(longName, { exact: true })).toBeVisible();
      await dialog.getByLabel(longName).check();
      await expectInsideViewport(page, dialog);
      await expectMarkerInsideHeaderAndClearOfNeighbors(header, 'Trait');
      if (width === 320 || width === 390) {
        await captureReviewScreenshot(page, {
          path: `/tmp/table-filter-menu-${width}.png`,
          fullPage: false,
        });
      }
      await dialog.getByRole('button', { name: 'Close filter' }).click();
      await expect(table.getByRole('rowgroup', { name: longName })).toBeVisible();
      await expect(page.getByText('1 column filter active')).toBeVisible();

      // The second open confirms a saved choice is still selected across table remounts.
      await header.click({ button: 'right' });
      const reopened = page.getByRole('dialog', { name: 'Filter Trait' });
      await expect(reopened.getByLabel(longName)).toBeChecked();
      await reopened.getByRole('button', { name: 'Close filter' }).click();
      if (width === 320) {
        const pointsHeader = table.getByRole('columnheader', { name: /Points/ });
        await pointsHeader.click({ button: 'right' });
        const pointsDialog = page.getByRole('dialog', { name: 'Filter Points' });
        await expectInsideViewport(page, pointsDialog);
        await pointsDialog.locator('input[type="checkbox"]').first().check();
        await pointsDialog.getByRole('button', { name: 'Close filter' }).click();
        await expectMarkerInsideHeaderAndClearOfNeighbors(pointsHeader, 'Points');
        await captureReviewScreenshot(page, {
          path: '/tmp/table-filter-points-320.png',
          fullPage: false,
        });
        await page.getByRole('button', { name: 'Clear all filters' }).click();
      }
    }

    // A reload preserves the device preference; table text search and sort remain usable.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await selectCharacterSection(page, 'Traits');
    const traits = page.getByRole('table', { name: 'Traits' });
    await expect(traits.getByRole('rowgroup', { name: longName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search traits' }).fill('no matching search text');
    await expect(page.getByText(/No traits match/i)).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search traits' }).clear();
    await expect(traits.getByRole('rowgroup', { name: longName })).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page.getByText(/column filter active/)).toHaveCount(0);
    await expect(traits.getByRole('rowgroup', { name: longName })).toBeVisible();

    await selectCharacterSection(page, 'Skills');
    const skills = page.getByRole('table', { name: 'Skills' });
    await expect(skills).toBeVisible();
    await page.getByRole('button', { name: 'Sort by Skill' }).click();
    await expect(skills.getByRole('row').nth(1)).toBeVisible();
    const skillHeader = skills.getByRole('columnheader', { name: /Skill/ });
    await skillHeader.click({ button: 'right' });
    const skillDialog = page.getByRole('dialog', { name: 'Filter Skill' });
    await expectInsideViewport(page, skillDialog);
    const skillName = await skillDialog.locator('label').nth(0).innerText();
    const option = skillDialog.getByLabel(skillName.trim());
    await option.check();
    await skillDialog.getByRole('button', { name: 'Close filter' }).click();
    await expect(page.getByText('1 column filter active')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).click();
  } finally {
    await removeLongTrait(page, characterId, traitId);
  }
});
