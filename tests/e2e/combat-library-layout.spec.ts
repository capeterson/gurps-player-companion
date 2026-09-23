import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

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

async function expectVisibleRangeLabelsAligned(panel: Locator, slider: Locator) {
  const sliderBox = await slider.boundingBox();
  expect(sliderBox).not.toBeNull();
  if (!sliderBox) return;

  const minimum = Number(await slider.getAttribute('min'));
  const maximum = Number(await slider.getAttribute('max'));
  const thumbRadius = sliderBox.height / 2;
  const usableWidth = sliderBox.width - 2 * thumbRadius;
  const labels = panel.locator('[data-range-label]');
  const labelBoxes = [];

  for (let index = 0; index < (await labels.count()); index += 1) {
    const label = labels.nth(index);
    const value = Number(await label.getAttribute('data-range-label'));
    const percent = (value - minimum) / (maximum - minimum);
    const expectedX = sliderBox.x + thumbRadius + percent * usableWidth;
    const marker = panel.locator(`[data-range-point="${value}"]`);
    const [labelBox, markerBox, anchor] = await Promise.all([
      label.boundingBox(),
      marker.boundingBox(),
      label.getAttribute('data-range-anchor'),
    ]);
    expect(labelBox).not.toBeNull();
    expect(markerBox).not.toBeNull();
    expect(anchor).not.toBeNull();
    if (!labelBox || !markerBox || !anchor) continue;

    const markerCenter = markerBox.x + markerBox.width / 2;
    const labelAnchor =
      anchor === 'start'
        ? labelBox.x
        : anchor === 'end'
          ? labelBox.x + labelBox.width
          : labelBox.x + labelBox.width / 2;
    expect(Math.abs(markerCenter - expectedX)).toBeLessThanOrEqual(1);
    expect(Math.abs(labelAnchor - expectedX)).toBeLessThanOrEqual(1);
    labelBoxes.push(labelBox);
  }

  for (let first = 0; first < labelBoxes.length; first += 1) {
    for (let second = first + 1; second < labelBoxes.length; second += 1) {
      const a = labelBoxes[first];
      const b = labelBoxes[second];
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
  }
}

async function expectCurrentStatusPoolPanelAt(page: Page, width: number) {
  await page.setViewportSize({ width, height: 568 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  const bar = page.getByRole('complementary', { name: 'Current Status' });
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();

  for (const pool of ['HP', 'FP'] as const) {
    const trigger = bar.getByRole('button', { name: `Adjust ${pool}` });
    await trigger.click();
    const panel = page.getByRole('group', { name: `${pool} adjustment` });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('group', { name: / adjustment$/ })).toHaveCount(1);
    await expectVisibleRangeLabelsAligned(
      panel,
      panel.getByRole('slider', { name: `Set ${pool}` }),
    );

    const current = panel.getByLabel(`Current ${pool}`);
    const before = Number(await current.textContent());
    const decrease = panel.getByRole('button', {
      name: `Decrease ${pool} by 1`,
    });
    const increase = panel.getByRole('button', {
      name: `Increase ${pool} by 1`,
    });
    await expect(decrease).toBeVisible();
    await expect(increase).toBeVisible();

    const [triggerBox, panelBox, decreaseBox, increaseBox] = await Promise.all([
      trigger.boundingBox(),
      panel.boundingBox(),
      decrease.boundingBox(),
      increase.boundingBox(),
    ]);
    expect(triggerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(decreaseBox).not.toBeNull();
    expect(increaseBox).not.toBeNull();
    if (barBox && triggerBox && panelBox && decreaseBox && increaseBox) {
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
      expect(panelBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(568);
      if (width < 1280) {
        expect(Math.abs(panelBox.x + panelBox.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      } else {
        // The shared overlay helper shifts an anchored panel when it would
        // cross the viewport's 8px safety margin.
        const expectedX = Math.max(8, Math.min(triggerBox.x, width - 8 - panelBox.width));
        expect(Math.abs(panelBox.x - expectedX)).toBeLessThanOrEqual(1);
        const triggerGap = panelBox.y - (triggerBox.y + triggerBox.height);
        expect(triggerGap).toBeGreaterThanOrEqual(0);
        expect(triggerGap).toBeLessThanOrEqual(12);
      }
      for (const buttonBox of [decreaseBox, increaseBox]) {
        expect(buttonBox.width).toBeGreaterThanOrEqual(44);
        expect(buttonBox.height).toBeGreaterThanOrEqual(44);
        expect(buttonBox.x).toBeGreaterThanOrEqual(panelBox.x);
        expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
      }
    }

    await decrease.click();
    await expect(current).toHaveText(String(before - 1));
    await increase.click();
    await expect(current).toHaveText(String(before));
  }
}

test('Current Status stays available and combat stays compact across mobile and desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page);
  await page.goto('/settings');
  const posturePreference = page.getByRole('checkbox', {
    name: 'Show posture in Current Status',
  });
  const maneuverPreference = page.getByRole('checkbox', {
    name: 'Show maneuver in Current Status',
  });
  const conditionsPreference = page.getByRole('checkbox', {
    name: 'Show conditions in Current Status',
  });
  await expect(posturePreference).not.toBeChecked();
  await expect(maneuverPreference).not.toBeChecked();
  await expect(conditionsPreference).not.toBeChecked();
  await posturePreference.check();
  await maneuverPreference.check();
  await conditionsPreference.check();

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const character = await api(page, '/characters', {
      name: `Compact hero ${width}`,
      st: 15,
      ht: 15,
    });
    await page.goto(`/characters/${character.id}`);
    const overview = page.getByRole('button', { name: /^Sheet overview/ });
    await expect(overview).toHaveCount(0);
    await selectCharacterSection(page, 'Overview');
    await expect(overview).toBeVisible();
    await expect(overview).toHaveAttribute('aria-expanded', 'true');
    const overviewBox = await overview.boundingBox();
    const identityBox = await page
      .getByRole('button', { name: 'Identity', exact: true })
      .boundingBox();
    expect(overviewBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    if (overviewBox && identityBox) expect(overviewBox.y).toBeLessThan(identityBox.y);
    const status = page.getByRole('complementary', { name: 'Current Status' });
    await expect(status).toBeVisible();
    await expect(status.getByRole('button', { name: /^Adjust HP,/ })).toBeVisible();
    await expect(status.getByRole('button', { name: /^Adjust FP,/ })).toBeVisible();
    await expect(page.getByText('Description', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit raw markdown' }).click();
    await page
      .getByRole('textbox', { name: 'description', exact: true })
      .fill('**Field guide** description');
    await page.getByRole('button', { name: 'Back to rich text' }).click();
    await expect(page.getByLabel('description').locator('strong')).toHaveText('Field guide');
    await selectCharacterSection(page, 'Combat');
    await expect(overview).toHaveCount(0);
    await expect(status).toBeVisible();
    await expect(page.getByRole('group', { name: 'Hit points', exact: true })).toHaveCount(0);
    const defenseAndDr = page.getByRole('region', {
      name: /Defense and damage resistance/i,
    });
    await expect(defenseAndDr).toBeVisible();
    await expect(page.getByLabel('Armor facing')).toBeVisible();
    await expect(page.getByLabel('Armor facing')).toHaveValue('front');
    await expect(page.getByLabel('Armor facing').getByRole('option', { name: 'Left' })).toHaveCount(
      1,
    );
    await expect(
      page.getByLabel('Armor facing').getByRole('option', { name: 'Right' }),
    ).toHaveCount(1);
    await expect(
      page.getByLabel('Armor facing').getByRole('option', { name: 'Unknown' }),
    ).toHaveCount(0);
    await expect(page.getByText('Active defenses', { exact: true })).toBeVisible();
    await expect(page.getByRole('rowgroup', { name: 'Move' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Defense order' })).toHaveCount(0);
    await expect(page.getByText('All locations and DR types', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Custom effect', exact: true })).toHaveCount(0);
    await status.getByRole('button', { name: 'Change maneuver, current None' }).click();
    await status.getByRole('button', { name: 'Attack', exact: true }).click();
    await expect(
      status.getByRole('button', { name: 'Change maneuver, current Attack' }),
    ).toBeVisible();
    await status.getByRole('button', { name: 'Change conditions, current None' }).click();
    await status.getByRole('button', { name: 'Stunned', exact: true }).click();
    await status.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      status.getByRole('button', { name: 'Change conditions, current Stunned' }),
    ).toBeVisible();
    await expect(status.getByRole('button', { name: 'Sleeping', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(status).toBeVisible();
    await expect(
      status.getByRole('button', { name: 'Change maneuver, current Attack' }),
    ).toBeVisible();
    await expect(defenseAndDr).toBeVisible();
    await expect(defenseAndDr.getByRole('button', { name: /Incoming damage…/ })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    if (width === 320) {
      await page.setViewportSize({ width, height: 568 });
      await defenseAndDr.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      const bar = page.getByRole('complementary', { name: 'Current Status' });
      await expect(bar).toBeVisible();
      await bar.getByRole('button', { name: /^Adjust HP,/ }).click();
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
      const decreaseHp = hpPanel.getByRole('button', {
        name: 'Decrease HP by 1',
      });
      const decreaseHpBox = await decreaseHp.boundingBox();
      expect(decreaseHpBox?.width).toBeGreaterThanOrEqual(44);
      expect(decreaseHpBox?.height).toBeGreaterThanOrEqual(44);
      const hpBefore = Number(await currentHp.textContent());
      await decreaseHp.click();
      await expect(currentHp).toHaveText(String(hpBefore - 1));
      await hpPanel.getByRole('button', { name: 'Increase HP by 1' }).click();
      await expect(currentHp).toHaveText(String(hpBefore));
      const slider = hpPanel.getByRole('slider', { name: 'Set HP' });
      await expectVisibleRangeLabelsAligned(hpPanel, slider);
      await expect
        .poll(async () => {
          const box = await hpPanel.boundingBox();
          return box
            ? box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 568
            : false;
        })
        .toBe(true);

      await bar.getByRole('button', { name: /^Adjust FP,/ }).click();
      await expect(hpPanel).toHaveCount(0);
      const fpPanel = page.getByRole('group', { name: 'FP adjustment' });
      await expect(fpPanel).toBeVisible();
      await expectVisibleRangeLabelsAligned(
        fpPanel,
        fpPanel.getByRole('slider', { name: 'Set FP' }),
      );
      await expect
        .poll(async () => {
          const box = await fpPanel.boundingBox();
          return box
            ? box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 568
            : false;
        })
        .toBe(true);

      for (const breakpointWidth of [
        477, 575, 639, 640, 641, 768, 1023, 1024, 1025, 1279, 1280, 1281, 1440,
      ]) {
        await expectCurrentStatusPoolPanelAt(page, breakpointWidth);
      }
    }
  }
});

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
  const editor = page.getByRole('textbox', {
    name: 'Description',
    exact: true,
  });
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
