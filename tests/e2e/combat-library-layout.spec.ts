import { type Page, expect, test } from '@playwright/test';

async function register(page: Page) {
  await page.goto('/register');
  await page
    .getByLabel(/email/i)
    .fill(`compact-library-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel(/display name/i).fill('Layout player');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
}
async function api(page: Page, path: string, data: object) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`/api/v1${path}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

for (const width of [320, 1280]) {
  test(`combat stays compact and remembers folds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await register(page);
    const character = await api(page, '/characters', { name: 'Compact hero' });
    await page.goto(`/characters/${character.id}`);
    const overview = page.getByRole('button', { name: /^Sheet overview/ });
    await expect(overview).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Identity', exact: true }).click();
    await expect(page.getByLabel('current HP')).toHaveCount(0);
    await expect(page.getByLabel('current FP')).toHaveCount(0);
    await expect(page.getByLabel('Hit points')).toHaveCount(0);
    await expect(page.getByLabel('Fatigue points')).toHaveCount(0);
    await page.getByRole('button', { name: 'Combat', exact: true }).click();
    const hp = page.getByRole('group', { name: 'Hit points', exact: true });
    await expect(hp).toBeVisible();
    expect((await hp.boundingBox())?.y).toBeLessThan(700);
    const defenseAndDr = page.getByRole('region', {
      name: /Defense and damage resistance/i,
    });
    await expect(defenseAndDr).toBeVisible();
    await expect(page.getByLabel('Armor facing')).toBeVisible();
    await expect(page.getByText('Active defenses', { exact: true })).toBeVisible();
    await expect(page.getByRole('rowgroup', { name: 'Move' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Defense order' })).toHaveCount(0);
    await expect(page.getByText('All locations and DR types', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Custom effect', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Attack$/, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('button', { name: 'Attack', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Attack', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Edit conditions' }).click();
    await page.getByRole('button', { name: 'Stunned', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stunned', pressed: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sleeping', exact: true })).toHaveCount(0);
    const pools = page.getByRole('button', { name: /^HP & FP/ });
    await pools.click();
    await page.reload();
    await expect(page.getByRole('button', { name: /^HP & FP/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(defenseAndDr).toBeVisible();
    await page.getByRole('button', { name: /^HP & FP/ }).click();
    await expect(defenseAndDr.getByRole('button', { name: /Incoming damage…/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    if (width === 320) {
      await page.setViewportSize({ width, height: 568 });
      await defenseAndDr.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      const bar = page.getByRole('complementary', { name: 'Current HP and FP' });
      await expect(bar).toBeVisible();
      await bar.getByRole('button', { name: 'Adjust HP' }).click();
      const hpPanel = page.getByRole('group', { name: 'HP adjustment' });
      await expect(hpPanel).toBeVisible();
      const [barBox, hpPanelBox] = await Promise.all([bar.boundingBox(), hpPanel.boundingBox()]);
      expect(barBox).not.toBeNull();
      expect(hpPanelBox).not.toBeNull();
      if (barBox && hpPanelBox) {
        const panelGap = hpPanelBox.y - (barBox.y + barBox.height);
        expect(panelGap).toBeGreaterThanOrEqual(0);
        expect(panelGap).toBeLessThanOrEqual(12);
      }
      const currentHp = hpPanel.getByLabel('Current HP');
      const decreaseHp = hpPanel.getByRole('button', { name: 'Decrease HP by 1' });
      const decreaseHpBox = await decreaseHp.boundingBox();
      expect(decreaseHpBox?.width).toBeGreaterThanOrEqual(44);
      expect(decreaseHpBox?.height).toBeGreaterThanOrEqual(44);
      await decreaseHp.click();
      await expect(currentHp).toHaveText('9');
      await hpPanel.getByRole('button', { name: 'Increase HP by 1' }).click();
      await expect(currentHp).toHaveText('10');
      const slider = hpPanel.getByRole('slider', { name: 'Set HP' });
      const maximum = Number(await slider.getAttribute('max'));
      const reelingEnds = Math.ceil(maximum / 3);
      for (const [value, percent] of [
        [-maximum, 0],
        [0, 0.5],
        [reelingEnds, (reelingEnds + maximum) / (2 * maximum)],
        [maximum, 1],
      ] as const) {
        const [sliderBox, markerBox] = await Promise.all([
          slider.boundingBox(),
          hpPanel.locator(`[data-range-point="${value}"]`).boundingBox(),
        ]);
        expect(sliderBox).not.toBeNull();
        expect(markerBox).not.toBeNull();
        if (!sliderBox || !markerBox) continue;
        const markerCenter = markerBox.x + markerBox.width / 2;
        const thumbRadius = sliderBox.height / 2;
        const expectedX = sliderBox.x + thumbRadius + percent * (sliderBox.width - 2 * thumbRadius);
        expect(Math.abs(markerCenter - expectedX)).toBeLessThanOrEqual(1);
      }
      await expect
        .poll(async () => {
          const box = await hpPanel.boundingBox();
          return box
            ? box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 568
            : false;
        })
        .toBe(true);

      await bar.getByRole('button', { name: 'Adjust FP' }).click();
      await expect(hpPanel).toHaveCount(0);
      const fpPanel = page.getByRole('group', { name: 'FP adjustment' });
      await expect(fpPanel).toBeVisible();
      await expect
        .poll(async () => {
          const box = await fpPanel.boundingBox();
          return box
            ? box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 568
            : false;
        })
        .toBe(true);
    }
  });
}

test('library search and markdown toolbar retain drafts and render formatted descriptions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await register(page);
  const campaign = await api(page, '/campaigns', { name: 'Markdown campaign' });
  await api(page, `/campaigns/${campaign.id}/library/traits`, {
    name: 'Night Vision',
    kind: 'advantage',
    basePoints: 1,
    description: '**Darkness** vision',
    source: 'B71',
  });
  await api(page, `/campaigns/${campaign.id}/library/traits`, {
    name: 'Fearfulness',
    kind: 'disadvantage',
    basePoints: -2,
  });
  await page.goto(`/campaigns/${campaign.id}/library`);
  const search = page.getByRole('searchbox', { name: 'Search library' });
  await search.fill('darkness B71');
  await expect(page.getByText('Night Vision', { exact: true })).toBeVisible();
  await expect(page.getByText('Fearfulness', { exact: true })).toHaveCount(0);
  await expect(page.locator('.markdown-body strong')).toHaveText('Darkness');
  await page.getByRole('button', { name: /Edit/ }).click();
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit raw markdown' }).click();
  const editor = page.getByRole('textbox', { name: 'Description', exact: true });
  await editor.fill('**Updated** description\n\n- First item\n- Second item');
  await search.fill('Fearfulness');
  await expect(editor).toHaveValue(/Updated/);
  await page.getByRole('button', { name: /^Skills \d/ }).click();
  await page.getByRole('button', { name: /^Traits \d/ }).click();
  await expect(editor).toHaveValue(/Updated/);
  await page.getByRole('button', { name: 'Back to rich text' }).click();
  await expect(page.locator('[contenteditable] strong')).toHaveText('Updated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.markdown-body strong')).toHaveText('Updated');
  await expect(page.locator('.markdown-body li')).toHaveCount(2);
  const titleBox = await page.getByText('Fearfulness', { exact: true }).boundingBox();
  expect(titleBox?.height).toBeLessThan(80);
  for (const category of ['Skills', 'Spells']) {
    await page.getByRole('button', { name: new RegExp(`^${category} \\d`) }).click();
    await page
      .getByRole('button', {
        name: new RegExp(`Add ${category === 'Skills' ? 'skill' : 'spell'}`, 'i'),
      })
      .click();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
